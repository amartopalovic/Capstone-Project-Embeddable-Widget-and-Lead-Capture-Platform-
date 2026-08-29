import { describe, expect, it } from 'vitest';
import {
  BASE_DELAY_MS,
  MAX_ATTEMPTS,
  MAX_DELAY_MS,
  backoffMs,
  classifyHttpStatus,
  classifyTransportError,
  nextAttemptAt,
  shouldRetry,
  terminalStatus,
} from '../src/domain/delivery/retry.js';
import {
  confirmationKey,
  jobId,
  maskEmail,
  notificationKey,
  outboxKey,
  replayKey,
  webhookKey,
} from '../src/domain/delivery/keys.js';
import {
  DEFAULT_NOTIFICATION_TEMPLATE,
  TEMPLATE_VARIABLES,
  containsMarkup,
  escapeHtml,
  renderTemplate,
  unknownVariables,
} from '../src/domain/delivery/templates.js';
import {
  checkDestination,
  checkDestinationUrl,
  classifyAddress,
} from '../src/domain/delivery/ssrf.js';
import {
  REPLAY_WINDOW_SECONDS,
  parseSignatureHeader,
  signPayload,
  signatureHeader,
  signaturesMatch,
  signingPayload,
  verifySignature,
} from '../src/domain/delivery/signing.js';

/**
 * Pure delivery rules (blueprint 18.1: "retry/backoff classification,
 * idempotency-key generation, template variable allowlisting, SSRF destination
 * validation, HMAC signing/verification").
 *
 * These decide whether a customer's endpoint gets hammered, whether a rejected
 * address burns the daily email allowance five times over, and whether a
 * webhook URL can be aimed at the cloud metadata service - so they are tested
 * as behaviour rather than inferred from the integration suite passing.
 */

const SECRET = 'whsec_unit-test-only-not-a-real-credential';

describe('failure classification (blueprint 5.3, 12.2)', () => {
  it('treats 429 as transient even though it is a 4xx', () => {
    // "Not now" is not "never" - the single most consequential exception in
    // the whole classification.
    expect(classifyHttpStatus(429)).toBe('transient');
  });

  it('treats every other 4xx as permanent', () => {
    for (const status of [400, 401, 403, 404, 409, 410, 422]) {
      expect(classifyHttpStatus(status), String(status)).toBe('permanent');
    }
  });

  it('treats 5xx as transient', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(classifyHttpStatus(status), String(status)).toBe('transient');
    }
  });

  it('treats an SSRF refusal as permanent, never as a network hiccup', () => {
    /**
     * The distinction that matters: WE refused, so retrying four more times
     * would be four more refusals against a destination that is still blocked.
     */
    expect(classifyTransportError(new Error('SSRF_BLOCKED private_address'))).toBe('permanent');
    expect(classifyTransportError(new Error('INVALID_DESTINATION'))).toBe('permanent');
  });

  it('treats an ordinary transport error as transient', () => {
    expect(classifyTransportError(new Error('ECONNRESET'))).toBe('transient');
    expect(classifyTransportError(new Error('socket hang up'))).toBe('transient');
  });

  it('never retries a permanent failure, however few attempts have been made', () => {
    expect(shouldRetry('permanent', 0)).toBe(false);
    expect(shouldRetry('permanent', 1)).toBe(false);
  });

  it('retries a transient failure up to five attempts, then stops', () => {
    for (let made = 1; made < MAX_ATTEMPTS; made += 1) {
      expect(shouldRetry('transient', made), `after ${String(made)}`).toBe(true);
    }
    expect(shouldRetry('transient', MAX_ATTEMPTS)).toBe(false);
  });

  it('sends a permanent failure to `failed` and an exhausted one to `dead_letter`', () => {
    /**
     * The distinction the replay button depends on: a dead letter might still
     * succeed, a permanent rejection never will.
     */
    expect(terminalStatus('permanent')).toBe('failed');
    expect(terminalStatus('transient')).toBe('dead_letter');
  });
});

describe('backoff (blueprint 12.2)', () => {
  /** No jitter, so the exponent itself can be asserted. */
  const noJitter = (): number => 0;

  it('doubles with each attempt', () => {
    expect(backoffMs(1, noJitter)).toBe(BASE_DELAY_MS);
    expect(backoffMs(2, noJitter)).toBe(BASE_DELAY_MS * 2);
    expect(backoffMs(3, noJitter)).toBe(BASE_DELAY_MS * 4);
    expect(backoffMs(4, noJitter)).toBe(BASE_DELAY_MS * 8);
  });

  it('never exceeds the ceiling', () => {
    expect(backoffMs(20, noJitter)).toBe(MAX_DELAY_MS);
  });

  it('applies jitter downward, so a retry never waits longer than advertised', () => {
    /**
     * Jittering upward would push a retry past the ceiling an operator was
     * told about. Downward-only keeps the promise while still breaking the
     * lockstep that turns a shared outage into a thundering herd.
     */
    const full = backoffMs(3, () => 0);
    const jittered = backoffMs(3, () => 1);
    expect(jittered).toBeLessThan(full);
    expect(jittered).toBeGreaterThan(0);
    for (const r of [0, 0.25, 0.5, 0.75, 1]) {
      expect(backoffMs(3, () => r)).toBeLessThanOrEqual(full);
    }
  });

  it('schedules the next attempt from the current time', () => {
    const now = new Date('2026-08-29T12:00:00.000Z');
    const next = nextAttemptAt(1, now, noJitter);
    expect(next.getTime() - now.getTime()).toBe(BASE_DELAY_MS);
  });
});

describe('idempotency keys (blueprint 12.2)', () => {
  const submission = '6a91aa54d159504587b4d886';

  it('is stable for the same logical notification', () => {
    expect(notificationKey(submission, 'a@example.invalid')).toBe(
      notificationKey(submission, 'a@example.invalid'),
    );
  });

  it('carries no timestamp or random part, or a retry would look like new work', () => {
    const key = notificationKey(submission, 'a@example.invalid');
    expect(key).toBe(`notify:${submission}:a@example.invalid`);
    expect(key).not.toMatch(/\d{13}/);
  });

  it('DISTINGUISHES two recipients of the same submission', () => {
    // Collapsing these would silently send to only the first colleague.
    expect(notificationKey(submission, 'a@example.invalid')).not.toBe(
      notificationKey(submission, 'b@example.invalid'),
    );
  });

  it('normalises recipient case, so one address is one notification', () => {
    expect(notificationKey(submission, 'A@Example.Invalid')).toBe(
      notificationKey(submission, 'a@example.invalid'),
    );
  });

  it('distinguishes the families from each other', () => {
    const keys = new Set([
      notificationKey(submission, 'a@example.invalid'),
      confirmationKey(submission),
      webhookKey(submission, '6a91aa54d159504587b4d887'),
      outboxKey(submission),
    ]);
    expect(keys.size).toBe(4);
  });

  it('gives a replay its own key, so the original does not block it', () => {
    /**
     * A replay is deliberate new work. Reusing the original key would make the
     * unique index refuse it - the operator would press the button and nothing
     * would happen.
     */
    const first = replayKey('6a91aa54d159504587b4d886', 1);
    const second = replayKey('6a91aa54d159504587b4d886', 2);
    expect(first).not.toBe(second);
    expect(first).not.toBe(notificationKey(submission, 'a@example.invalid'));
  });

  it('builds a job id that includes the type', () => {
    expect(jobId('webhook', 'hook:1:2')).toBe('webhook:hook:1:2');
  });
});

describe('masking addresses for logs and the dashboard (blueprint 9.4)', () => {
  it('keeps the domain and the first letter only', () => {
    expect(maskEmail('alice@example.com')).toBe('a****@example.com');
  });

  it('does not leak a short local part', () => {
    expect(maskEmail('a@example.com')).toBe('a**@example.com');
  });

  it('degrades safely on nonsense', () => {
    expect(maskEmail('not-an-address')).toBe('***');
  });
});

describe('template allowlisting (blueprint 12.3)', () => {
  const values = {
    'contact.name': 'Alice',
    'contact.email': 'alice@example.invalid',
    'submission.message': 'Hello',
  } as const;

  it('resolves an allowlisted variable', () => {
    expect(renderTemplate('Hi {{contact.name}}', values, false)).toBe('Hi Alice');
  });

  it('renders an UNKNOWN variable as nothing, never reaching into an object', () => {
    /**
     * The dangerous version of this feature resolves any path against whatever
     * it was handed. `{{user.passwordHash}}` must produce nothing at all.
     */
    expect(renderTemplate('x{{user.passwordHash}}y', values, false)).toBe('xy');
    expect(renderTemplate('x{{constructor}}y', values, false)).toBe('xy');
  });

  it('escapes a visitor value on the HTML side', () => {
    const hostile = { 'contact.name': '<script>alert(1)</script>' } as const;
    const rendered = renderTemplate('Hi {{contact.name}}', hostile, true);
    expect(rendered).not.toContain('<script>');
    expect(rendered).toContain('&lt;script&gt;');
  });

  it('does NOT escape on the text side, or an apostrophe becomes noise', () => {
    const rendered = renderTemplate('{{contact.name}}', { 'contact.name': "O'Hara" }, false);
    expect(rendered).toBe("O'Hara");
  });

  it('tolerates whitespace inside the braces', () => {
    expect(renderTemplate('{{  contact.name  }}', values, false)).toBe('Alice');
  });

  it('reports unknown placeholders so a save can be refused', () => {
    expect(unknownVariables('{{contact.name}} {{contact.nmae}}')).toEqual(['contact.nmae']);
    expect(unknownVariables('{{contact.name}}')).toEqual([]);
  });

  it('detects markup, which 12.3 forbids outright', () => {
    expect(containsMarkup('<b>hi</b>')).toBe(true);
    expect(containsMarkup('a < b and c > d')).toBe(false);
  });

  it('escapes every dangerous character', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });

  it('ships a default template that only uses allowlisted variables', () => {
    // The default is what an unconfigured widget sends, so it must satisfy the
    // same rule a customer's template does.
    expect(unknownVariables(DEFAULT_NOTIFICATION_TEMPLATE.subject)).toEqual([]);
    expect(unknownVariables(DEFAULT_NOTIFICATION_TEMPLATE.body)).toEqual([]);
  });

  it('offers exactly the documented variable list', () => {
    expect([...TEMPLATE_VARIABLES]).toContain('contact.email');
    expect([...TEMPLATE_VARIABLES]).not.toContain('contact.id');
  });
});

describe('SSRF destination validation (blueprint 12.4, 17)', () => {
  it('blocks loopback, private, link-local, and metadata addresses', () => {
    expect(classifyAddress('127.0.0.1')).toBe('loopback_address');
    expect(classifyAddress('::1')).toBe('loopback_address');
    expect(classifyAddress('10.1.2.3')).toBe('private_address');
    expect(classifyAddress('192.168.1.1')).toBe('private_address');
    expect(classifyAddress('172.16.0.1')).toBe('private_address');
    expect(classifyAddress('172.31.255.255')).toBe('private_address');
    expect(classifyAddress('169.254.1.1')).toBe('link_local_address');
    expect(classifyAddress('169.254.169.254')).toBe('metadata_service');
    expect(classifyAddress('fd00::1')).toBe('private_address');
    expect(classifyAddress('fe80::1')).toBe('link_local_address');
  });

  it('catches an IPv4-mapped IPv6 bypass', () => {
    /**
     * `::ffff:127.0.0.1` is IPv6 syntactically and IPv4 in effect. A check that
     * only looked at the textual form would wave it through.
     */
    expect(classifyAddress('::ffff:127.0.0.1')).toBe('loopback_address');
    expect(classifyAddress('::ffff:169.254.169.254')).toBe('metadata_service');
  });

  it('allows an ordinary public address', () => {
    expect(classifyAddress('203.0.113.10')).toBeNull();
    expect(classifyAddress('2606:2800:220:1:248:1893:25c8:1946')).toBeNull();
  });

  it('does not mistake 172.32 for the private 172.16/12 block', () => {
    // An off-by-one here would block a legitimate customer.
    expect(classifyAddress('172.32.0.1')).toBeNull();
    expect(classifyAddress('172.15.0.1')).toBeNull();
  });

  it('requires https when production rules apply', () => {
    expect(checkDestinationUrl('http://example.com/hook', true)).toMatchObject({
      ok: false,
      reason: 'https_required',
    });
    expect(checkDestinationUrl('https://example.com/hook', true).ok).toBe(true);
    // Development may target a local http receiver, which is what makes the
    // delivery integration tests possible without a certificate.
    expect(checkDestinationUrl('http://example.com/hook', false).ok).toBe(true);
  });

  it('rejects a non-http scheme outright', () => {
    for (const url of ['file:///etc/passwd', 'gopher://x/', 'ftp://x/']) {
      expect(checkDestinationUrl(url, false).ok, url).toBe(false);
    }
  });

  it('rejects credentials in the URL rather than silently stripping them', () => {
    // Somebody who pasted a secret needs to be told, not quietly rescued.
    expect(checkDestinationUrl('https://user:pass@example.com/hook', true)).toMatchObject({
      ok: false,
      reason: 'credentials_in_url',
    });
  });

  it('restricts the port, so a URL cannot probe an internal service', () => {
    expect(checkDestinationUrl('https://example.com:6379/', true)).toMatchObject({
      ok: false,
      reason: 'port_not_allowed',
    });
    expect(checkDestinationUrl('https://example.com:8443/hook', true).ok).toBe(true);
  });

  it('blocks a literal internal IP in the URL', () => {
    expect(checkDestinationUrl('http://169.254.169.254/latest/meta-data/', false)).toMatchObject({
      ok: false,
      reason: 'metadata_service',
    });
  });

  it('checks EVERY address a hostname resolves to, not only the first', async () => {
    /**
     * The attack this stops: an A record pointing at a public address and a
     * second pointing at loopback. Checking only the first would pass, and the
     * OS resolver would then connect wherever it liked.
     */
    const result = await checkDestination('https://sneaky.example/hook', true, async () => [
      '203.0.113.10',
      '127.0.0.1',
    ]);
    expect(result).toMatchObject({ ok: false, reason: 'loopback_address' });
  });

  it('allows a hostname whose addresses are all public', async () => {
    const result = await checkDestination('https://good.example/hook', true, async () => [
      '203.0.113.10',
    ]);
    expect(result.ok).toBe(true);
  });

  it('refuses a hostname that does not resolve', async () => {
    expect(
      await checkDestination('https://nowhere.example/hook', true, async () => []),
    ).toMatchObject({ ok: false, reason: 'hostname_not_resolvable' });

    expect(
      await checkDestination('https://nowhere.example/hook', true, async () => {
        throw new Error('ENOTFOUND');
      }),
    ).toMatchObject({ ok: false, reason: 'hostname_not_resolvable' });
  });
});

describe('webhook signing (blueprint 12.4)', () => {
  const body = JSON.stringify({ id: 'evt_1', data: { ok: true } });
  const timestamp = 1_800_000_000;

  it('signs the TIMESTAMP together with the body', () => {
    /**
     * A signature over the body alone is replayable forever. Binding the
     * timestamp into the signed material is what lets a receiver reject an old
     * capture.
     */
    expect(signingPayload(timestamp, body)).toBe(`${String(timestamp)}.${body}`);
    expect(signPayload(SECRET, timestamp, body)).not.toBe(signPayload(SECRET, timestamp + 1, body));
  });

  it('produces a stable hex signature', () => {
    const signature = signPayload(SECRET, timestamp, body);
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(signPayload(SECRET, timestamp, body)).toBe(signature);
  });

  it('changes completely with a different secret', () => {
    expect(signPayload(SECRET, timestamp, body)).not.toBe(
      signPayload('whsec_other', timestamp, body),
    );
  });

  it('formats and parses a versioned header', () => {
    const header = signatureHeader(['aaa', 'bbb']);
    expect(header).toBe('v1=aaa v1=bbb');
    expect(parseSignatureHeader(header)).toEqual(['aaa', 'bbb']);
  });

  it('compares in constant time without throwing on a length mismatch', () => {
    // `timingSafeEqual` throws when the buffers differ in length; the length
    // check in front of it is what stops a verification becoming a crash.
    const signature = signPayload(SECRET, timestamp, body);
    expect(signaturesMatch(signature, signature)).toBe(true);
    expect(signaturesMatch(signature, 'ab')).toBe(false);
    expect(signaturesMatch(signature, '')).toBe(false);
  });

  it('verifies a request signed with the current secret', () => {
    const header = signatureHeader([signPayload(SECRET, timestamp, body)]);
    expect(
      verifySignature({
        header,
        timestampSeconds: timestamp,
        body,
        secrets: [SECRET],
        nowSeconds: timestamp,
      }),
    ).toEqual({ ok: true });
  });

  it('accepts EITHER secret during a rotation overlap', () => {
    /**
     * The property that makes rotation non-breaking: a receiver that has
     * migrated and one that has not each find a signature they accept.
     */
    const oldSecret = 'whsec_old';
    const header = signatureHeader([
      signPayload(SECRET, timestamp, body),
      signPayload(oldSecret, timestamp, body),
    ]);
    for (const secret of [SECRET, oldSecret]) {
      expect(
        verifySignature({
          header,
          timestampSeconds: timestamp,
          body,
          secrets: [secret],
          nowSeconds: timestamp,
        }),
      ).toEqual({ ok: true });
    }
  });

  it('rejects a replayed request outside the window', () => {
    const header = signatureHeader([signPayload(SECRET, timestamp, body)]);
    expect(
      verifySignature({
        header,
        timestampSeconds: timestamp,
        body,
        secrets: [SECRET],
        nowSeconds: timestamp + REPLAY_WINDOW_SECONDS + 1,
      }),
    ).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  it('rejects a tampered body', () => {
    const header = signatureHeader([signPayload(SECRET, timestamp, body)]);
    expect(
      verifySignature({
        header,
        timestampSeconds: timestamp,
        body: `${body} tampered`,
        secrets: [SECRET],
        nowSeconds: timestamp,
      }),
    ).toEqual({ ok: false, reason: 'no_matching_signature' });
  });
});

import { describe, expect, it } from 'vitest';
import { MIN_FILL_MILLISECONDS, classifySubmission } from '../src/domain/submission/heuristics.js';
import {
  ipPseudonym,
  pseudonymPeriod,
  pseudonymsMatch,
} from '../src/domain/submission/ip-pseudonym.js';
import { monthStartInZone, submissionQuota } from '../src/domain/submission/quota.js';
import { isPrivateAddress } from '../src/infrastructure/geo/providers.js';

/**
 * Pure rules on the public submission path (blueprint 18.1: "spam heuristics",
 * "HMAC generation/verification and key rotation", "quota and Brevo budget
 * decisions", "retention cutoff calculations and workspace timezone
 * boundaries").
 *
 * These are the decisions that determine whether a real lead is kept or thrown
 * away, so they are tested as behaviour rather than inferred from the
 * integration suite passing.
 */

const SECRET = 'unit-test-only-not-a-real-secret';

describe('spam heuristics (blueprint 7.3 step 6)', () => {
  const base = { honeypot: undefined, renderedAt: undefined, receivedAt: 1_000_000 };

  it('accepts an ordinary submission', () => {
    expect(classifySubmission(base)).toEqual({ accepted: true });
  });

  it('rejects any value at all in the honeypot', () => {
    expect(classifySubmission({ ...base, honeypot: 'bot@example.com' })).toEqual({
      accepted: false,
      reason: 'honeypot',
    });
    // An empty string is what a real browser sends for an untouched field.
    expect(classifySubmission({ ...base, honeypot: '' })).toEqual({ accepted: true });
    expect(classifySubmission({ ...base, honeypot: '   ' })).toEqual({ accepted: true });
  });

  it('rejects a form submitted faster than a human could fill it', () => {
    const verdict = classifySubmission({
      ...base,
      renderedAt: base.receivedAt - (MIN_FILL_MILLISECONDS - 100),
    });
    expect(verdict).toEqual({ accepted: false, reason: 'timing' });
  });

  it('accepts a form filled at human speed', () => {
    expect(
      classifySubmission({ ...base, renderedAt: base.receivedAt - MIN_FILL_MILLISECONDS - 1 }),
    ).toEqual({ accepted: true });
  });

  it('accepts a page left open for hours rather than calling it suspicious', () => {
    // A background tab is ordinary behaviour, not an attack.
    const aDayAndAHalf = 36 * 60 * 60 * 1000;
    expect(classifySubmission({ ...base, renderedAt: base.receivedAt - aDayAndAHalf })).toEqual({
      accepted: true,
    });
  });

  it('accepts a missing or skewed render time instead of punishing the visitor', () => {
    /**
     * `renderedAt` is client-supplied, so a determined bot simply omits it.
     * Treating absence as guilt would only cost real visitors whose browser or
     * an extension interfered - the honeypot is the check with teeth.
     */
    expect(classifySubmission({ ...base, renderedAt: undefined })).toEqual({ accepted: true });
    expect(classifySubmission({ ...base, renderedAt: Number.NaN })).toEqual({ accepted: true });
    // A clock ahead of the server's.
    expect(classifySubmission({ ...base, renderedAt: base.receivedAt + 5_000 })).toEqual({
      accepted: true,
    });
  });
});

describe('rotating IP pseudonym (blueprint 9.4)', () => {
  const january = new Date('2026-01-15T12:00:00.000Z');
  const february = new Date('2026-02-15T12:00:00.000Z');

  it('is stable for one address within a rotation period', () => {
    const first = ipPseudonym(SECRET, '203.0.113.5', january);
    const second = ipPseudonym(SECRET, '203.0.113.5', new Date('2026-01-28T23:59:00.000Z'));
    expect(first.value).toBe(second.value);
    expect(first.period).toBe('2026-01');
  });

  it('changes when the month turns, so linkage does not outlive the window', () => {
    const before = ipPseudonym(SECRET, '203.0.113.5', january);
    const after = ipPseudonym(SECRET, '203.0.113.5', february);
    expect(after.value).not.toBe(before.value);
    expect(after.period).toBe('2026-02');
  });

  it('separates two addresses', () => {
    expect(ipPseudonym(SECRET, '203.0.113.5', january).value).not.toBe(
      ipPseudonym(SECRET, '203.0.113.6', january).value,
    );
  });

  it('changes completely if the key material changes', () => {
    expect(ipPseudonym(SECRET, '203.0.113.5', january).value).not.toBe(
      ipPseudonym('a-different-secret', '203.0.113.5', january).value,
    );
  });

  it('never contains the address it was derived from', () => {
    const { value } = ipPseudonym(SECRET, '203.0.113.5', january);
    expect(value).toMatch(/^[0-9a-f]{64}$/);
    expect(value).not.toContain('203');
  });

  it('normalises trivial formatting differences', () => {
    expect(ipPseudonym(SECRET, ' 203.0.113.5 ', january).value).toBe(
      ipPseudonym(SECRET, '203.0.113.5', january).value,
    );
  });

  it('writes the period as a UTC year-month', () => {
    expect(pseudonymPeriod(new Date('2026-03-01T00:00:00.000Z'))).toBe('2026-03');
    // Just before UTC midnight on the last day, still the old period.
    expect(pseudonymPeriod(new Date('2026-02-28T23:59:59.000Z'))).toBe('2026-02');
  });

  it('compares safely, including when the lengths differ', () => {
    const { value } = ipPseudonym(SECRET, '203.0.113.5', january);
    expect(pseudonymsMatch(value, value)).toBe(true);
    expect(pseudonymsMatch(value, `${value}extra`)).toBe(false);
    expect(pseudonymsMatch(value, '')).toBe(false);
  });
});

describe('monthly submission quota (blueprint 4.10)', () => {
  it('allows submissions below the cap and refuses the one that would exceed it', () => {
    expect(submissionQuota(0).allowed).toBe(true);
    expect(submissionQuota(1999).allowed).toBe(true);
    expect(submissionQuota(2000)).toEqual({ allowed: false, used: 2000, limit: 2000 });
  });
});

describe('month boundaries use the WORKSPACE timezone (blueprint 4.10)', () => {
  it('starts the month at local midnight, not UTC midnight', () => {
    // 1 March 00:30 in Auckland is still 28 February in UTC. The workspace's
    // month has already turned; the server's has not.
    const now = new Date('2026-02-28T11:30:00.000Z');
    const start = monthStartInZone(now, 'Pacific/Auckland');

    expect(start.getTime()).toBeLessThanOrEqual(now.getTime());
    // The boundary is 1 March local, which is late February in UTC.
    expect(start.toISOString().startsWith('2026-02-28')).toBe(true);
  });

  it('agrees with UTC for a workspace in UTC', () => {
    const start = monthStartInZone(new Date('2026-05-17T09:00:00.000Z'), 'UTC');
    expect(start.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });

  it('handles a zone behind UTC, where the month turns later', () => {
    // 1 May 00:00 in Los Angeles is 07:00 UTC on 1 May.
    const start = monthStartInZone(new Date('2026-05-17T09:00:00.000Z'), 'America/Los_Angeles');
    expect(start.toISOString()).toBe('2026-05-01T07:00:00.000Z');
  });

  it('is never in the future relative to the instant asked about', () => {
    for (const zone of ['UTC', 'Europe/Berlin', 'Asia/Kolkata', 'Pacific/Auckland']) {
      const now = new Date('2026-07-01T00:30:00.000Z');
      expect(monthStartInZone(now, zone).getTime(), zone).toBeLessThanOrEqual(now.getTime());
    }
  });
});

describe('geo providers skip addresses no service can answer for', () => {
  it('treats loopback and private ranges as unanswerable', () => {
    for (const ip of ['127.0.0.1', '::1', '10.0.0.4', '192.168.1.9', '172.16.5.1', '172.31.9.9']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it('treats a routable address as worth asking about', () => {
    for (const ip of ['203.0.113.5', '8.8.8.8', '172.32.0.1', '172.15.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});

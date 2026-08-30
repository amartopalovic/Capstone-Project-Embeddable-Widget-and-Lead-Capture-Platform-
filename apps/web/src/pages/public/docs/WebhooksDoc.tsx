import { CodeBlock } from '../../../components/CodeBlock.jsx';
import { DOC_SECTIONS, DocSection, DocsShell, Note, Settings } from '../DocsShell.jsx';

/**
 * Webhooks, and how to verify one.
 *
 * The verification example is the reason this page exists. A signing scheme
 * documented in prose is a signing scheme somebody will implement wrongly - in
 * particular by comparing with `===`, by signing the parsed body instead of the
 * raw bytes, and by ignoring the timestamp entirely. All three are called out
 * with the code that avoids them.
 */

const PAYLOAD = `{
  "id": "665f1c2a9b4e7d1a3c8f0021",
  "version": "1",
  "type": "submission.received",
  "createdAt": "2026-08-30T09:14:22.104Z",
  "attempt": 1,
  "data": {
    "submissionId": "665f1c2a9b4e7d1a3c8f0020",
    "contactId": "665f1c2a9b4e7d1a3c8f001f",
    "widgetId": "665f1b119b4e7d1a3c8f0003",
    "widgetName": "Pricing enquiries",
    "submittedAt": "2026-08-30T09:14:21.980Z",
    "values": {
      "email": "dana@example.com",
      "name": "Dana Whitlock",
      "message": "Could you send pricing for 25 seats?"
    },
    "source": {
      "domain": "shop.example.com",
      "pageUrl": "https://shop.example.com/pricing"
    },
    "geo": { "countryCode": "GB", "city": "Bristol" }
  }
}`;

const VERIFY_NODE = `import { createHmac, timingSafeEqual } from 'node:crypto';
import express from 'express';

const SECRET = process.env.LCP_WEBHOOK_SECRET;
const TOLERANCE_SECONDS = 300;

const app = express();

// The RAW body, not the parsed one. Signing is over exact bytes, and
// JSON.parse followed by JSON.stringify will not reproduce them.
app.post('/hooks/lead', express.raw({ type: 'application/json' }), (req, res) => {
  const timestamp = req.get('x-lcp-timestamp');
  const header = req.get('x-lcp-signature');
  if (!timestamp || !header) return res.status(400).end();

  // Reject anything too old. Without this, a captured request replays forever.
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) return res.status(400).end();

  const body = req.body.toString('utf8');
  const expected = createHmac('sha256', SECRET)
    .update(\`\${timestamp}.\${body}\`)
    .digest('hex');

  // The header may carry TWO signatures during a secret rotation, separated by
  // a space. Accept the request if either matches.
  const offered = header
    .split(/\\s+/)
    .filter((part) => part.startsWith('v1='))
    .map((part) => part.slice(3));

  const ok = offered.some((signature) => {
    const a = Buffer.from(signature, 'hex');
    const b = Buffer.from(expected, 'hex');
    // timingSafeEqual THROWS on a length mismatch, so check length first.
    return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
  });

  if (!ok) return res.status(401).end();

  const event = JSON.parse(body);
  console.log('lead received', event.data.values.email);

  // Answer quickly. Do the slow part after responding.
  res.status(200).end();
});`;

const VERIFY_PYTHON = `import hmac, hashlib, time
from flask import Flask, request

SECRET = os.environ["LCP_WEBHOOK_SECRET"].encode()
TOLERANCE_SECONDS = 300

app = Flask(__name__)

@app.post("/hooks/lead")
def lead():
    timestamp = request.headers.get("X-LCP-Timestamp", "")
    header = request.headers.get("X-LCP-Signature", "")
    if not timestamp or not header:
        return "", 400

    if abs(int(time.time()) - int(timestamp)) > TOLERANCE_SECONDS:
        return "", 400

    # The raw bytes, exactly as received.
    body = request.get_data()
    expected = hmac.new(
        SECRET, f"{timestamp}.".encode() + body, hashlib.sha256
    ).hexdigest()

    offered = [p[3:] for p in header.split() if p.startswith("v1=")]
    if not any(hmac.compare_digest(s, expected) for s in offered):
        return "", 401

    event = request.get_json()
    print("lead received", event["data"]["values"]["email"])
    return "", 200`;

export function WebhooksDoc(): React.JSX.Element {
  return (
    <DocsShell
      sections={DOC_SECTIONS}
      navLabel="Documentation"
      title="Webhooks"
      intro="Get each accepted lead posted to your own endpoint, signed so you can prove it came from us and has not been replayed."
    >
      <DocSection title="Add an endpoint">
        <p>
          Under Delivery → Webhooks. The URL is checked before it is saved and again before every
          send, and the rules are stricter than they look:
        </p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>HTTPS, and a publicly resolvable host.</li>
          <li>Port 80, 443, 8080, or 8443. Anything else is refused rather than attempted.</li>
          <li>
            Every address the host resolves to must be public. Private, loopback, and link-local
            ranges are rejected — including a host that resolves to one of them at send time, not
            just at save time.
          </li>
          <li>Redirects are not followed. A 3xx is a failure, not a hop.</li>
        </ul>
        <p>
          The signing secret is shown once, when the endpoint is created or rotated, and never
          again. Store it before you leave the page.
        </p>
      </DocSection>

      <DocSection title="What arrives">
        <p>
          A <code className="font-mono text-[13px] text-ink">POST</code> with{' '}
          <code className="font-mono text-[13px] text-ink">Content-Type: application/json</code> and
          three headers that matter:
        </p>
        <Settings
          rows={[
            {
              term: 'X-LCP-Signature',
              description: (
                <>
                  One or more signatures, each written{' '}
                  <code className="font-mono text-[12px]">v1=&lt;hex&gt;</code> and separated by a
                  space. Two are present during a secret rotation.
                </>
              ),
            },
            {
              term: 'X-LCP-Timestamp',
              description: 'Unix seconds. Part of the signed material, not just metadata.',
            },
            {
              term: 'Content-Type',
              description: 'application/json',
            },
          ]}
        />
        <CodeBlock language="json" code={PAYLOAD} caption="A submission.received event." />
        <p>
          <code className="font-mono text-[13px] text-ink">values</code> holds exactly what the
          visitor typed, keyed by field. The set depends on the widget, so read the keys you expect
          and ignore the rest rather than asserting on the whole shape.
        </p>
      </DocSection>

      <DocSection title="Verify the signature">
        <p>
          The signed material is the timestamp, a full stop, and the raw request body —{' '}
          <code className="font-mono text-[13px] text-ink">{'`${timestamp}.${body}`'}</code> —
          hashed with HMAC-SHA256 using your endpoint’s secret. Three details decide whether an
          implementation is actually safe:
        </p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            <strong className="font-medium text-ink">Sign the raw bytes.</strong> Parsing the JSON
            and re-serialising it will not reproduce them, and the signature will never match.
          </li>
          <li>
            <strong className="font-medium text-ink">Check the timestamp.</strong> The signature
            alone proves origin, not freshness. Without a tolerance window, a captured request
            replays forever. We suggest 300 seconds.
          </li>
          <li>
            <strong className="font-medium text-ink">Compare in constant time.</strong> A plain{' '}
            <code className="font-mono text-[13px]">===</code> leaks how much of the signature was
            correct, one byte at a time.
          </li>
        </ul>

        <CodeBlock language="javascript · node + express" code={VERIFY_NODE} />
        <CodeBlock language="python · flask" code={VERIFY_PYTHON} />
      </DocSection>

      <DocSection title="Rotating the secret">
        <p>
          Rotating issues a new secret while the previous one keeps verifying for 24 hours. During
          that window every request carries both signatures, so you can deploy the new secret
          without dropping deliveries in between:
        </p>
        <CodeBlock
          language="text"
          code={`X-LCP-Signature: v1=9f2c...e11a v1=41bd...77c0
                 ↑ new secret     ↑ previous secret, valid for 24h`}
        />
        <p>Accept the request if either signature matches, which the examples above already do.</p>
      </DocSection>

      <DocSection title="Retries, and what we treat as failure">
        <p>
          Answer with any 2xx and we consider it delivered. Answer quickly — do slow work after
          responding, because a timeout counts as a failure.
        </p>
        <Settings
          rows={[
            {
              term: 'Transient',
              description:
                'A timeout, a connection error, a 429, or any 5xx. Retried up to five times with exponential backoff and jitter, then moved to dead-letter where you can replay it by hand.',
            },
            {
              term: 'Permanent',
              description:
                'A 4xx other than 429. Not retried — it would fail again for the same reason. It appears as rejected in Delivery health with the status we received.',
            },
          ]}
        />
        <Note>
          Deliveries are attempted after the lead is safely stored, never before. A webhook that is
          down cannot cause a submission to be lost or rejected — the lead is already in your inbox.
        </Note>
      </DocSection>

      <DocSection title="Duplicates">
        <p>
          Retries mean your endpoint can receive the same event more than once. The{' '}
          <code className="font-mono text-[13px] text-ink">id</code> field is stable across every
          attempt of one delivery, and{' '}
          <code className="font-mono text-[13px] text-ink">attempt</code> counts up. Key on{' '}
          <code className="font-mono text-[13px] text-ink">id</code> and ignore an event you have
          already handled.
        </p>
      </DocSection>
    </DocsShell>
  );
}

import { CodeBlock } from '../../../components/CodeBlock.jsx';
import { DOC_SECTIONS, DocSection, DocsShell, Note, Settings } from '../DocsShell.jsx';

/**
 * The API overview, and the way into Swagger UI.
 *
 * The reference itself is generated and served by the API (blueprint 10.1), so
 * this page deliberately does not restate any endpoint. What it does is the
 * part a generated reference is bad at: explaining that there are three
 * differently-secured surfaces, and that version 1 has no API keys - which is
 * the first thing somebody trying to script against it needs to know, and the
 * thing they will otherwise spend an hour discovering.
 */
export function ApiDoc(): React.JSX.Element {
  return (
    <DocsShell
      sections={DOC_SECTIONS}
      navLabel="Documentation"
      title="API reference"
      intro="Three surfaces, secured three different ways. The full reference is generated from the running server."
    >
      <DocSection title="Open the reference">
        <p>
          Every endpoint, its request shape, and its responses are in the OpenAPI document the API
          serves about itself. It opens in Swagger UI, where you can read it or call it.
        </p>
        <p className="flex flex-wrap gap-3 pt-1">
          <a
            href="/api-reference"
            className="border border-signal bg-signal px-5 py-2.5 text-sm font-medium text-white hover:bg-signal-hover"
          >
            Open Swagger UI
          </a>
          <a
            href="/api/v1/openapi.json"
            className="border border-edge bg-panel px-5 py-2.5 text-sm font-medium text-ink hover:bg-paper"
          >
            Download openapi.json
          </a>
        </p>
        <Note>
          The document is built in the same process that serves the API. Request bodies are
          generated from the exact validators the routes run, and a test asserts that the paths it
          declares are precisely the routes the server dispatches — so it cannot describe an
          endpoint that does not exist, or quietly omit one that does.
        </Note>
      </DocSection>

      <DocSection title="There are no API keys">
        <p>
          Version 1 issues none, deliberately. The dashboard API authenticates with the same server
          session your browser holds after signing in, which means it is not callable from a script
          or a server-to-server integration.
        </p>
        <p>
          If you want lead data outside the dashboard, the two supported routes are the{' '}
          <strong className="font-medium text-ink">webhook</strong>, which pushes each accepted lead
          to your endpoint, and the <strong className="font-medium text-ink">export</strong>, which
          streams the current filter as CSV or JSON. Both are documented and neither needs a
          credential we do not have.
        </p>
      </DocSection>

      <DocSection title="The three surfaces">
        <Settings
          rows={[
            {
              term: '/api/v1',
              description: (
                <>
                  The dashboard. A session cookie identifies you, and every state-changing request
                  also needs an <code className="font-mono text-[12px]">X-CSRF-Token</code> header
                  from <code className="font-mono text-[12px]">GET /api/v1/auth/csrf</code>. Which
                  workspace a request applies to comes from the session, never from the request — so
                  there is no workspace id to pass and none to get wrong.
                </>
              ),
            },
            {
              term: '/widget/v1',
              description:
                'What a visitor’s browser calls from a customer’s site. No credentials at all. A widget is identified by its opaque public id, and what protects it is the allowed-domain check, rate limits, a body cap, and a server-owned field schema.',
            },
            {
              term: '/public/v1',
              description:
                'Reached from links in emails by people with no account — unsubscribe, opt-in confirmation, and verified data export or deletion. A signed or single-use token in the body is the entire authorization.',
            },
          ]}
        />
      </DocSection>

      <DocSection title="Errors">
        <p>Every failure uses one envelope, whichever surface produced it:</p>
        <CodeBlock
          language="json"
          code={`{
  "error": {
    "code": "validation_failed",
    "message": "Check the submitted fields",
    "correlationId": "9a1f6c2e-4d3b-4a1e-9c77-2b0d5f8e1a34",
    "details": [
      { "path": "email", "message": "Enter a valid email address" }
    ]
  }
}`}
        />
        <p>
          Match on <code className="font-mono text-[13px] text-ink">code</code>, never on{' '}
          <code className="font-mono text-[13px] text-ink">message</code> — the codes are stable and
          the wording is not. <code className="font-mono text-[13px] text-ink">details</code> is
          present only where per-field information makes sense.{' '}
          <code className="font-mono text-[13px] text-ink">correlationId</code> is the same value
          that appears in the server logs for that request, so quoting it in a bug report is worth
          more than a screenshot.
        </p>
        <p>
          Expected client failures return a 4xx. Malformed or oversized input is never a 500. An
          update that would overwrite somebody else’s concurrent change returns 409 with the current
          version rather than silently winning.
        </p>
      </DocSection>

      <DocSection title="Listing and pagination">
        <p>
          Lists use keyset pagination: a response carries{' '}
          <code className="font-mono text-[13px] text-ink">nextCursor</code>, and you pass it back
          as <code className="font-mono text-[13px] text-ink">cursor</code>. There are no page
          numbers, because a lead arriving mid-listing would shift every offset and quietly hide a
          row.
        </p>
      </DocSection>

      <DocSection title="Probes">
        <p>
          <code className="font-mono text-[13px] text-ink">/health/live</code> answers whether the
          process is up and deliberately touches no dependency, so a database blip never causes the
          platform to be restarted.{' '}
          <code className="font-mono text-[13px] text-ink">/health/ready</code> checks what the API
          needs to serve traffic. A degraded optional provider — geo lookup, for instance — does not
          make the API unready.
        </p>
      </DocSection>
    </DocsShell>
  );
}

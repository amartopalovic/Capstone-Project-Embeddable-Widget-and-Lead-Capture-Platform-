import { Link } from 'react-router';
import { DOC_SECTIONS, DocsShell, Note } from '../DocsShell.jsx';

/**
 * Troubleshooting.
 *
 * Organised by the SYMPTOM somebody actually has, not by subsystem. A person
 * whose widget will not appear does not know whether that is a targeting
 * problem, a publish problem, or a domain problem - which is the whole reason
 * they are reading this.
 */

function Problem({
  symptom,
  causes,
}: {
  readonly symptom: string;
  readonly causes: readonly { readonly check: string; readonly fix: React.ReactNode }[];
}): React.JSX.Element {
  const id = symptom.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return (
    <section aria-labelledby={id} className="border-t border-edge pt-8">
      <h2 id={id} className="text-xl font-semibold tracking-tight text-ink">
        {symptom}
      </h2>
      <dl className="mt-4 space-y-5">
        {causes.map((cause) => (
          <div key={cause.check}>
            <dt className="text-sm font-medium text-ink">{cause.check}</dt>
            <dd className="mt-1 leading-relaxed text-muted">{cause.fix}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function TroubleshootingDoc(): React.JSX.Element {
  return (
    <DocsShell
      sections={DOC_SECTIONS}
      navLabel="Documentation"
      title="Troubleshooting"
      intro="Sorted by what you are seeing rather than by which part of the system is responsible, because you cannot know that yet."
    >
      <Problem
        symptom="The widget does not appear at all"
        causes={[
          {
            check: 'Has it been published?',
            fix: 'Editing changes a draft. Visitors see the last published revision, and a widget that has never been published serves nothing. The Widgets screen shows the state beside each one.',
          },
          {
            check: 'Is the page’s domain on the allowed list?',
            fix: (
              <>
                A wildcard covers subdomains but not the bare domain, so{' '}
                <code className="font-mono text-[13px]">*.example.com</code> does not match{' '}
                <code className="font-mono text-[13px]">example.com</code>. Add both if you need
                both. Remember that changing the list only takes effect when you publish again.
              </>
            ),
          },
          {
            check: 'Do the targeting patterns match this page?',
            fix: (
              <>
                Excludes are applied after includes and always win. If you have an include of{' '}
                <code className="font-mono text-[13px]">/blog/*</code>, note that it matches one
                level only — <code className="font-mono text-[13px]">/blog/**</code> is what matches
                everything beneath.
              </>
            ),
          },
          {
            check: 'Is the snippet actually on the page?',
            fix: (
              <>
                View source and look for{' '}
                <code className="font-mono text-[13px]">script[data-widget]</code>. Tag managers and
                page builders sometimes strip attributes from pasted HTML, which leaves a script tag
                that loads the file and then has nothing to do.
              </>
            ),
          },
          {
            check: 'Is it a popover waiting for its trigger?',
            fix: 'A CTA popover is meant not to appear until its trigger fires — a delay, a scroll depth, or exit intent. Check the trigger in the builder, and remember a visitor who dismissed it is in its cooldown.',
          },
        ]}
      />

      <Problem
        symptom="Submissions are rejected"
        causes={[
          {
            check: 'A 403 means the Origin was not allowed.',
            fix: 'The domain check is made on the server against the browser’s Origin header. This is the same cause as the widget not appearing, seen from the other side — the widget rendered from a cached page but the domain has since changed.',
          },
          {
            check: 'A 429 means a rate limit was reached.',
            fix: 'Limits apply per visitor and per widget. In normal use they are generous; if you are testing repeatedly from one machine you will meet them long before a real visitor does.',
          },
          {
            check: 'A 400 with field details means validation failed.',
            fix: 'The response names the fields. Field rules come from the published revision, so a field you have just added in the draft does not exist for visitors until you publish.',
          },
          {
            check: 'A 413 means the body was too large.',
            fix: 'Requests are capped at 32 KB. A very long message field is the usual cause.',
          },
        ]}
      />

      <Problem
        symptom="A lead is missing from the inbox"
        causes={[
          {
            check: 'Was it treated as spam?',
            fix: (
              <>
                A hidden honeypot field and a timing floor reject automated submissions. These
                appear on the Analytics page under blocked and throttled activity, with counts only
                — the values are deliberately not kept, so a rejected submission never becomes a
                shadow lead database.
              </>
            ),
          },
          {
            check: 'Was it merged into an existing lead?',
            fix: 'A second submission from the same address updates the existing contact rather than creating a new one, and appears in that lead’s timeline. Search by the address rather than scanning the list.',
          },
          {
            check: 'Is it in the trash?',
            fix: 'Deleted leads are recoverable for 30 days from Inbox → Trash.',
          },
          {
            check: 'Has the monthly limit been reached?',
            fix: 'A workspace accepts 2,000 submissions per month, counted on your own timezone boundary. The Overview page shows the meter.',
          },
        ]}
      />

      <Problem
        symptom="Email is not arriving"
        causes={[
          {
            check: 'Check Delivery health first.',
            fix: (
              <>
                It distinguishes <em>rejected</em> — a permanent failure, usually a bad address —
                from <em>gave up</em>, which exhausted its retries and can be replayed by hand. A
                delivery still queued shows as waiting rather than as a failure.
              </>
            ),
          },
          {
            check: 'Is it marketing email to an unsubscribed address?',
            fix: (
              <>
                Suppression is workspace-wide and survives the lead being deleted. See{' '}
                <Link
                  to="/docs/consent"
                  className="text-signal underline decoration-signal/40 underline-offset-4 hover:decoration-signal"
                >
                  consent and unsubscribe
                </Link>
                .
              </>
            ),
          },
          {
            check: 'Is the recipient an external address awaiting verification?',
            fix: 'A notification recipient outside your workspace must confirm their own address before anything is sent to it, so a widget cannot be used to mail a stranger.',
          },
          {
            check: 'Is the daily provider allowance exhausted?',
            fix: 'The free tier reserves its allowance for account and privacy email first. Side-effect email beyond that stays queued until the next window rather than being dropped, and shows as waiting.',
          },
        ]}
      />

      <Problem
        symptom="A webhook is not being received"
        causes={[
          {
            check: 'Was the URL refused when you saved it?',
            fix: 'It must be HTTPS, on port 80, 443, 8080, or 8443, and every address its host resolves to must be public. A tunnel to localhost will not be accepted.',
          },
          {
            check: 'Does your endpoint answer with a 2xx quickly?',
            fix: 'A timeout counts as a transient failure and consumes a retry. Answer first, then do the slow work.',
          },
          {
            check: 'Are you following a redirect?',
            fix: 'We do not follow them. A 3xx is recorded as a failure, so point the endpoint at its final URL.',
          },
          {
            check: 'Does your signature check pass?',
            fix: (
              <>
                The three usual causes are signing the parsed body instead of the raw bytes,
                ignoring the timestamp, and not handling the two signatures sent during a rotation.
                The{' '}
                <Link
                  to="/docs/webhooks"
                  className="text-signal underline decoration-signal/40 underline-offset-4 hover:decoration-signal"
                >
                  webhook guide
                </Link>{' '}
                has working examples.
              </>
            ),
          },
        ]}
      />

      <Problem
        symptom="Analytics look wrong"
        causes={[
          {
            check: 'A rate shows “no data” rather than a percentage.',
            fix: 'That is deliberate and it is not a bug. It means the denominator was zero, and rendering 0% would claim that people arrived and did not act. A contact form is always visible, so it has no “opened” step and its open rate is genuinely undefined — the page says so where that is the reason.',
          },
          {
            check: 'Views are counted but no leads appear.',
            fix: 'Views and submissions are recorded separately, so a widget that is being seen but not filled in shows exactly that. Check the funnel to see which step people are leaving at.',
          },
          {
            check: 'Country and city are empty.',
            fix: 'Location is only recorded for submissions, not for views. A widget with traffic but no leads shows nothing on those two dashboards.',
          },
          {
            check: 'Older raw data has disappeared.',
            fix: 'Raw events are retired after 90 days. The daily counters built from them are kept, so the dashboards keep their history even though the individual events are gone.',
          },
        ]}
      />

      <Note tone="warning">
        This is a portfolio deployment on free infrastructure. The service may sleep between
        requests, so the first request after a quiet period can be slow, and background work —
        email, webhooks, retention sweeps — resumes when it wakes rather than running on an exact
        schedule. That is delay, not loss.
      </Note>
    </DocsShell>
  );
}

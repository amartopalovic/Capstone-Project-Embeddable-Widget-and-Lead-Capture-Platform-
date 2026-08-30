import { Link } from 'react-router';
import { PublicShell } from '../../components/PublicShell.jsx';

/**
 * The landing page (blueprint 14.2).
 *
 * The visitor this page is built for is not a buyer. It is far more likely to
 * be somebody evaluating the work - a reviewer, a hiring engineer - who wants
 * four answers quickly: what is it, is it actually real, how does it hold up,
 * and where is the proof. A page of testimonials and pricing tiers would answer
 * none of those and would read as worse engineering, not better.
 *
 * So the hero is the EMBED SNIPPET rather than a headline over a gradient. Two
 * lines of HTML are the whole product in miniature: they cross an origin
 * boundary, carry an opaque public id, and turn somebody else's website into a
 * lead source. Showing the artifact first is the fastest honest answer to "is
 * this real".
 *
 * The page is then organised as the route a lead travels rather than as a
 * feature list, because that route is a genuine sequence - the data physically
 * moves through those stages - which is the only thing that justifies numbering
 * them. Each stage names the specific hard part rather than a benefit.
 */

/**
 * The snippet, exactly as the builder prints it.
 *
 * `async`, `data-widget` rather than a query string, and an id from the real
 * alphabet - which drops `l`, `o`, `0`, and `1` so it survives being read aloud
 * and retyped. Kept in step with `embedSnippet` in the server's widget domain,
 * because a landing page showing a subtly different tag teaches people to paste
 * something that does not work.
 *
 * Broken across two lines where the builder prints one. HTML treats whitespace
 * between attributes as insignificant, so this pastes and behaves identically -
 * and it is the only way the whole tag is legible at this size. Letting the
 * browser wrap it instead put the break inside `data-widget`, at the hyphen,
 * which reads like a typo in the one thing a visitor might copy.
 */
const SNIPPET = `<script async src="https://your-instance.example/widget/v1/loader.js"
        data-widget="w_8fk2m4qp7xz9nv3d"></script>`;

interface Stage {
  readonly label: string;
  readonly title: string;
  readonly body: string;
  readonly detail: readonly string[];
}

/**
 * The five stages a lead passes through.
 *
 * Ordered because the order is real, not because numbering looks tidy: nothing
 * reaches the inbox that did not first survive the checks, and nothing is
 * measured or delivered that never landed.
 */
const STAGES: readonly Stage[] = [
  {
    label: 'Install',
    title: 'One script tag, on a site we do not control',
    body: 'You build the widget in a settings form with a live preview, publish it, and paste the snippet. The runtime renders in a shadow root, so a host page’s CSS cannot reshape your form and yours cannot leak into theirs.',
    detail: [
      'Contact form, email signup, or CTA popover',
      'Draft and published revisions, so editing never changes what visitors see until you publish',
      'Under 6 KB gzipped, with no framework in the public bundle',
    ],
  },
  {
    label: 'Submit',
    title: 'A stranger’s browser posts to your workspace',
    body: 'Cross-origin, unauthenticated, and from a page we have never seen. Everything that makes that safe is enforced on the server, because anything enforced in the widget is enforced by the attacker.',
    detail: [
      'Allowed-domain list checked against the request Origin',
      '32 KB body cap; malformed or oversized input returns a clean 4xx, never a 500',
      'Honeypot and timing heuristics, per-IP and per-widget rate limits',
      'Idempotency keys, so a retried submission is not a second lead',
    ],
  },
  {
    label: 'Work',
    title: 'It arrives in an inbox your team shares',
    body: 'Live, over one authenticated stream per workspace. Roles decide what each person can do, and the server decides the roles — the interface asks the API what you may do rather than keeping its own copy of the table.',
    detail: [
      'Search across what the visitor actually wrote, not just their name',
      'Merge duplicates, act on a selection, and undo a deletion for 30 days',
      'Optimistic concurrency, so two people editing one lead get a conflict rather than a silent overwrite',
      'Streaming CSV or JSON export of exactly the filter on screen',
    ],
  },
  {
    label: 'Measure',
    title: 'Eight dashboards that refuse to guess',
    body: 'Counts, trends, the funnel, per-widget performance, geography, sources, lead status, delivery health, and blocked traffic — all from one aggregate read.',
    detail: [
      'A rate with no denominator reads “no data”, never 0% — “nobody arrived” and “nobody acted” are different claims',
      'Raw events retire after 90 days; the durable counters do not',
      'No cookie, no IP, and no fingerprint stored — only a rotating pseudonym, scoped to one widget',
    ],
  },
  {
    label: 'Deliver, then forget',
    title: 'Email and webhooks that fail honestly',
    body: 'Side effects happen after the lead is durable, so a provider outage can never lose one. What is owed to the person who filled in the form is honoured on a schedule.',
    detail: [
      'HMAC-SHA256 signed webhooks, SSRF-checked, with a 24-hour secret rotation overlap',
      'Five retries with backoff, a dead-letter state, and manual replay',
      'Double opt-in, workspace-wide unsubscribe, verified export and deletion',
      'Retention windows that actually fire, including after the service has been asleep',
    ],
  },
];

/** The one place on the page where the mount bracket appears. */
function Bracket({ tone = 'edge' }: { readonly tone?: 'edge' | 'signal' }): React.JSX.Element {
  const colour = tone === 'signal' ? 'border-signal/50' : 'border-edge';
  const tick = `absolute h-4 w-4 ${colour}`;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute -inset-3">
      <span className={`${tick} left-0 top-0 border-l border-t`} />
      <span className={`${tick} right-0 top-0 border-r border-t`} />
      <span className={`${tick} bottom-0 left-0 border-b border-l`} />
      <span className={`${tick} bottom-0 right-0 border-b border-r`} />
    </div>
  );
}

export function LandingPage(): React.JSX.Element {
  return (
    <PublicShell>
      {/* ------------------------------------------------------------ hero */}
      <section className="border-b border-edge">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-signal">
            Embeddable widgets &middot; Lead capture
          </p>
          <h1 className="mt-4 max-w-3xl text-pretty text-4xl font-semibold leading-[1.1] tracking-tight text-ink sm:text-5xl">
            Put a form on someone else’s website and trust what comes back.
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted">
            Build a widget, publish it, and paste one script tag. Leads arrive in a shared inbox in
            real time, already checked, deduplicated, and counted.
          </p>

          {/*
           * The snippet, as the hero. A `figure` rather than a decorative
           * block, because it IS the content: this is the artifact a customer
           * installs, and showing it before anything else is the shortest
           * honest answer to "what does using this look like".
           */}
          <figure className="relative mt-12 max-w-3xl">
            <Bracket tone="signal" />
            <figcaption className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
              What you paste into your page
            </figcaption>
            {/*
             * The line breaks are in the string, not left to the browser.
             * Auto-wrapping broke inside `data-widget` at its hyphen, which
             * reads like a typo in the one thing on this page a visitor might
             * copy. Focusable because it can still scroll on a narrow screen,
             * and a region only a mouse can scroll hides content from a
             * keyboard entirely.
             */}
            <pre
              tabIndex={0}
              aria-label="Embed snippet"
              className="mt-3 overflow-x-auto border border-edge bg-panel px-5 py-5 text-[13px] leading-relaxed text-ink sm:text-sm"
            >
              <code>{SNIPPET}</code>
            </pre>
          </figure>

          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Link
              to="/register"
              className="border border-signal bg-signal px-5 py-2.5 text-sm font-medium text-white hover:bg-signal-hover"
            >
              Create an account
            </Link>
            <Link
              to="/docs/install"
              className="border border-edge bg-panel px-5 py-2.5 text-sm font-medium text-ink hover:bg-paper"
            >
              Read the install guide
            </Link>
            <Link
              to="/docs/api"
              className="text-sm text-signal underline decoration-signal/40 underline-offset-4 hover:decoration-signal"
            >
              Browse the API
            </Link>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------- honest framing */}
      <section aria-labelledby="honesty" className="border-b border-edge bg-panel">
        <div className="mx-auto max-w-6xl px-5 py-10">
          <div className="grid gap-6 sm:grid-cols-[14rem_1fr]">
            <h2
              id="honesty"
              className="font-mono text-[11px] uppercase tracking-[0.18em] text-danger"
            >
              Read this first
            </h2>
            <div className="max-w-2xl space-y-3 text-sm leading-relaxed text-ink">
              <p>
                This is a portfolio project, built to a written blueprint and deployed on free
                infrastructure. It is not a company and it is not sold.
              </p>
              <p className="text-muted">
                The hosted instance carries no service level agreement and may sleep between
                requests. Put synthetic data in it, never anything real: the demo tenants and their
                contents can be reset, and email to external addresses is deliberately limited.
                Everything the documentation describes is built and tested — where something is not
                finished, the docs say so rather than implying it.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------- the lead's journey */}
      <section aria-labelledby="journey" className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
        <h2 id="journey" className="text-2xl font-semibold tracking-tight text-ink">
          What happens to a lead
        </h2>
        <p className="mt-2 max-w-2xl text-muted">
          In order, because the order is real. Nothing reaches the inbox that did not survive the
          checks, and nothing is measured that never landed.
        </p>

        <ol className="mt-12 space-y-14">
          {STAGES.map((stage, index) => (
            <li key={stage.label} className="grid gap-6 sm:grid-cols-[14rem_1fr]">
              <div>
                {/*
                 * The number is information here: these are sequential stages
                 * of one journey, so the position tells the reader where they
                 * are in it.
                 */}
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
                  <span className="text-signal">{String(index + 1).padStart(2, '0')}</span>
                  {'  '}
                  {stage.label}
                </p>
              </div>

              <div className="max-w-2xl border-l border-edge pl-6">
                <h3 className="text-lg font-semibold text-ink">{stage.title}</h3>
                <p className="mt-2 leading-relaxed text-muted">{stage.body}</p>
                <ul className="mt-4 space-y-2">
                  {stage.detail.map((line) => (
                    <li key={line} className="flex gap-3 text-sm text-ink">
                      <span aria-hidden="true" className="mt-2 h-px w-3 shrink-0 bg-signal/60" />
                      <span className="text-muted">{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ------------------------------------------------------- the proof */}
      <section aria-labelledby="proof" className="border-t border-edge bg-panel">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 id="proof" className="text-2xl font-semibold tracking-tight text-ink">
            How to check any of this
          </h2>
          <p className="mt-2 max-w-2xl text-muted">
            Claims on a landing page are worth what you paid for them. These are the things you can
            open yourself.
          </p>

          <div className="mt-8 grid gap-px border border-edge bg-edge sm:grid-cols-3">
            {[
              {
                title: 'The API contract',
                body: 'An OpenAPI document generated in the same process that serves the API, with request shapes derived from the validators the routes actually use. A test asserts it describes every route the server dispatches and no others.',
                to: '/docs/api',
                cta: 'Open the reference',
              },
              {
                title: 'The install guide',
                body: 'The real snippet, the real configuration, and a worked webhook signature check you can run against your own endpoint. Written from what the product does today.',
                to: '/docs/install',
                cta: 'Read the docs',
              },
              {
                title: 'Your own data',
                body: 'If you have filled in a form powered by this platform, you can ask to see everything held about you, or have it deleted, by confirming from your own inbox. No account needed.',
                to: '/privacy',
                cta: 'See or delete your data',
              },
            ].map((card) => (
              <div key={card.title} className="bg-panel p-6">
                <h3 className="text-base font-semibold text-ink">{card.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{card.body}</p>
                <p className="mt-4">
                  <Link
                    to={card.to}
                    className="text-sm text-signal underline decoration-signal/40 underline-offset-4 hover:decoration-signal"
                  >
                    {card.cta}
                  </Link>
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </PublicShell>
  );
}

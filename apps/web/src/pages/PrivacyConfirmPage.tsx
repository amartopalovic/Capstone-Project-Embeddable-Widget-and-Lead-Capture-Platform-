import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { PrivacyExport, PrivacyRequestCompleted } from '@lcp/contracts';
import { privacyApi } from '../lib/api.js';
import { NoticeBody, PublicNotice } from '../components/PublicNotice.jsx';

/**
 * Complete a verified export or deletion (blueprint 4.8).
 *
 * The token is the whole authorization: it is single-use, expires in 24 hours,
 * and is stored only as a hash. Everything below happens because somebody
 * proved control of the address from their own inbox.
 *
 * The export is the hard part of this page. It is genuinely a lot of data - a
 * contact record, every field of every submission, and the consent history -
 * and the obvious thing to do with it is dump JSON. That would be technically
 * complete and practically useless: this is the one view where a person who is
 * not a developer needs to READ what a company holds about them.
 *
 * So it is a record, not a payload. Definition lists for anything that is a
 * label and a value, because that is exactly what `dl` means and a screen
 * reader announces the pairing for free; a real table for the consent history,
 * because that is rows of the same shape. Nothing is collapsed behind a toggle:
 * hiding somebody's own data behind a click, on the page they asked to see it,
 * would be a strange thing to do.
 */

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const id = `section-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <section aria-labelledby={id} className="border border-edge bg-panel p-6">
      <h2 id={id} className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** One label-and-value pair, the unit this whole view is built from. */
function Pair({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | null;
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-1 border-t border-edge py-3 sm:grid-cols-[13rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="break-words text-sm text-ink">
        {value === null || value === '' ? (
          // Not "—": somebody reading their own record should be told the field
          // is empty in words, not left to interpret a dash.
          <span className="text-muted">Not provided</span>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

function ExportView({ data }: { readonly data: PrivacyExport }): React.JSX.Element {
  return (
    <div className="space-y-6">
      <Section title="Your details">
        <dl className="-mt-3">
          <Pair label="Email address" value={data.contact.email} />
          <Pair label="Name" value={data.contact.name} />
          <Pair label="Phone" value={data.contact.phone} />
          <Pair label="Company" value={data.contact.company} />
          <Pair label="First heard from you" value={formatDate(data.contact.firstSubmissionAt)} />
          <Pair label="Last heard from you" value={formatDate(data.contact.lastSubmissionAt)} />
          <Pair label="Marketing email" value={consentWording(data.contact.consentState)} />
        </dl>
      </Section>

      <Section title={`What you sent (${String(data.submissions.length)})`}>
        {data.submissions.length === 0 ? (
          <p className="text-sm text-muted">No form submissions are held.</p>
        ) : (
          <ol className="space-y-6">
            {data.submissions.map((submission, index) => (
              <li key={`${submission.submittedAt}-${String(index)}`}>
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                  <time dateTime={submission.submittedAt}>
                    {formatDate(submission.submittedAt)}
                  </time>
                  {submission.pageUrl !== null && (
                    <>
                      {' · '}
                      <span className="normal-case tracking-normal">{submission.pageUrl}</span>
                    </>
                  )}
                </p>
                <dl className="mt-2">
                  {Object.entries(submission.values).length === 0 ? (
                    <p className="border-t border-edge py-3 text-sm text-muted">
                      The contents of this submission have been erased.
                    </p>
                  ) : (
                    Object.entries(submission.values).map(([field, value]) => (
                      <Pair key={field} label={humanizeField(field)} value={value} />
                    ))
                  )}
                </dl>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title={`Consent history (${String(data.consentEvents.length)})`}>
        {data.consentEvents.length === 0 ? (
          <p className="text-sm text-muted">No consent has been recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">
                Every time consent was given, confirmed, or withdrawn, with the exact wording shown
                at the time
              </caption>
              <thead>
                <tr>
                  {['When', 'What happened', 'The wording you were shown'].map((heading) => (
                    <th
                      key={heading}
                      scope="col"
                      className="pb-2 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.consentEvents.map((event) => (
                  <tr key={event.id} className="border-t border-edge align-top">
                    <th scope="row" className="whitespace-nowrap py-3 pr-4 text-left font-normal">
                      <time dateTime={event.occurredAt} className="font-mono text-[12px] text-ink">
                        {formatDate(event.occurredAt)}
                      </time>
                    </th>
                    <td className="py-3 pr-4 text-ink">
                      {eventWording(event.type, event.granted)}
                    </td>
                    {/*
                     * The wording itself, quoted - but ONLY for an event that
                     * came from a form, because only then was any wording
                     * actually shown. Following a link out of an email displays
                     * no consent text, and putting this system's own
                     * description of that action in a column headed "the
                     * wording you were shown" would be a small lie in the one
                     * document that has to be exact.
                     */}
                    <td className="py-3 text-muted">
                      {event.source === 'widget_form' ? (
                        event.text
                      ) : (
                        <span className="text-muted">No wording was shown</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

export function PrivacyConfirmPage(): React.JSX.Element {
  const [params] = useSearchParams();
  const token = params.get('token');

  const [result, setResult] = useState<PrivacyRequestCompleted | null>(null);
  const [failed, setFailed] = useState(false);

  /**
   * The token this page has already spent.
   *
   * This guard is load-bearing, not a tidy-up. The token is single-use by
   * design, so a second call for the same one is REFUSED - and React runs
   * effects twice in development, which means the naive version consumed the
   * token on the first pass and then rendered "this link is no longer valid"
   * from the second. The person's export completed on the server and they were
   * shown an error, with the link now genuinely spent.
   *
   * A ref rather than state, because it must be set before the request goes
   * out and must not itself trigger a render. Keyed by the token so a different
   * link on the same mounted page still works.
   */
  const spent = useRef<string | null>(null);

  useEffect(() => {
    if (token === null || token === '') return;
    if (spent.current === token) return;
    spent.current = token;

    void (async () => {
      const response = await privacyApi.complete(token);
      if (response.ok) setResult(response.data);
      else setFailed(true);
    })();
  }, [token]);

  if (token === null || token === '') {
    return (
      <PublicNotice eyebrow="Your data" heading="This link is incomplete." tone="refused">
        <NoticeBody>
          Open the link straight from your email rather than typing it in, and it will work.
        </NoticeBody>
      </PublicNotice>
    );
  }

  if (failed) {
    return (
      <PublicNotice eyebrow="Your data" heading="This link is no longer valid." tone="refused">
        <NoticeBody>
          It works once and expires 24 hours after it is sent, so it may have been used already.
          Start again and we will send a new one.
        </NoticeBody>
        <p className="mt-8 text-sm">
          <a
            href="/privacy"
            className="text-signal underline decoration-signal/40 underline-offset-4 hover:decoration-signal"
          >
            Start a new request
          </a>
        </p>
      </PublicNotice>
    );
  }

  if (result === null) {
    return (
      <PublicNotice eyebrow="Your data" heading="Checking your link.">
        <p role="status" className="text-sm text-muted">
          One moment.
        </p>
      </PublicNotice>
    );
  }

  if (result.kind === 'deletion') {
    return (
      <PublicNotice eyebrow="Your data" heading="Your data has been deleted." tone="settled">
        <NoticeBody>{result.message}</NoticeBody>
        <NoticeBody>
          This was immediate and cannot be undone. If you fill in one of their forms again, a new
          record starts from scratch - and you will stay unsubscribed from marketing email.
        </NoticeBody>
      </PublicNotice>
    );
  }

  const data = result.export;
  if (data === null) {
    return (
      <PublicNotice eyebrow="Your data" heading="Nothing is held about you." tone="neutral">
        <NoticeBody>There is no record to show.</NoticeBody>
      </PublicNotice>
    );
  }

  return (
    <PublicNotice
      eyebrow={`Held by ${data.workspace}`}
      heading="Everything they hold about you."
      wide
      footer={
        <>
          Prepared <time dateTime={data.generatedAt}>{formatDate(data.generatedAt)}</time>. This
          page is not saved anywhere - use your browser to print or save it if you want a copy.
        </>
      }
    >
      <ExportView data={data} />
    </PublicNotice>
  );
}

/**
 * Dates in the reader's own locale and zone.
 *
 * The rest of this product renders dates in the WORKSPACE's timezone, because
 * an operator reasons about their own business hours. Here the reader is the
 * visitor, and their own clock is the one that means anything to them.
 */
function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * A form field's stored key, made readable.
 *
 * The export holds values keyed by field id - `email`, `page_url` - because
 * that is how a submission is stored. Showing those raw would hand somebody
 * their own data in the vocabulary of the database, which is exactly what this
 * page exists not to do. The widget's own label would be better still, but it
 * is not carried on the submission; this is the honest improvement available
 * without inventing data.
 */
function humanizeField(field: string): string {
  const words = field.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function consentWording(state: PrivacyExport['contact']['consentState']): string {
  switch (state) {
    case 'confirmed':
      return 'Subscribed';
    case 'pending':
      return 'Asked to subscribe, not yet confirmed';
    case 'withdrawn':
      return 'Unsubscribed';
    default:
      return 'Never asked for';
  }
}

function eventWording(type: string, granted: boolean): string {
  if (type === 'withdrawal') return 'You unsubscribed';
  if (type === 'confirmation') return 'You confirmed your subscription';
  return granted ? 'You ticked the consent box' : 'You left the consent box unticked';
}

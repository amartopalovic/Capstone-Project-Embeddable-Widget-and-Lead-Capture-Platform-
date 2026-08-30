import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { ConsentLinkResult } from '@lcp/contracts';
import { consentApi } from '../lib/api.js';
import { NoticeBody, PublicNotice, type NoticeTone } from '../components/PublicNotice.jsx';

/**
 * Unsubscribe, and double opt-in confirmation (blueprint 4.8).
 *
 * One component for both, because they are the same page with a different verb:
 * a token arrives in the URL, it is posted once, and one of four outcomes is
 * stated. Splitting them would mean two copies of the same four-branch render
 * that could drift apart on the branch nobody looks at - the invalid one.
 *
 * The token is posted rather than acted on by the GET that brought the person
 * here. Mail clients and corporate scanners prefetch links; an unsubscribe
 * carried out by a GET would fire for people who merely received the email.
 */

type Purpose = 'unsubscribe' | 'confirm';

const COPY: Readonly<
  Record<Purpose, { readonly eyebrow: string; readonly working: string; readonly missing: string }>
> = {
  unsubscribe: {
    eyebrow: 'Subscription',
    working: 'Unsubscribing you.',
    missing: 'This unsubscribe link is incomplete.',
  },
  confirm: {
    eyebrow: 'Subscription',
    working: 'Confirming your subscription.',
    missing: 'This confirmation link is incomplete.',
  },
};

/**
 * How each outcome is presented.
 *
 * `invalid` is deliberately vague, and that is a security property rather than
 * an oversight: an expired token, an unknown token, and a token for a contact
 * that has since been deleted all say the same thing. Telling them apart would
 * let somebody test whether a given address is a lead in a given workspace.
 */
function present(
  purpose: Purpose,
  result: ConsentLinkResult,
): { tone: NoticeTone; heading: string; body: string } {
  switch (result.outcome) {
    case 'unsubscribed':
      return {
        tone: 'settled',
        heading: "You're unsubscribed.",
        body: 'No further marketing email will be sent to this address. Messages that answer something you do next, like a reply to a form you fill in, are not affected.',
      };
    case 'confirmed':
      return {
        tone: 'affirmed',
        heading: 'Your subscription is confirmed.',
        body: 'You can unsubscribe from any email you receive, at any time.',
      };
    case 'already':
      return {
        tone: 'neutral',
        heading:
          purpose === 'unsubscribe'
            ? "You're already unsubscribed."
            : 'Your subscription is already confirmed.',
        body: result.message,
      };
    case 'invalid':
    default:
      return {
        tone: 'refused',
        heading: 'This link is no longer valid.',
        body: 'It may have already been used, or it may have expired. If you were trying to unsubscribe, use the link in the most recent email you received.',
      };
  }
}

export function ConsentPage({ purpose }: { readonly purpose: Purpose }): React.JSX.Element {
  const [params] = useSearchParams();
  const token = params.get('token');

  const [result, setResult] = useState<ConsentLinkResult | null>(null);
  const [failed, setFailed] = useState(false);

  /**
   * Posted once per token, for the same reason as the privacy page.
   *
   * These two operations ARE idempotent - a second unsubscribe answers
   * "already" - so a double call would not corrupt anything. It would still
   * write a second consent event and race two responses into one render, and
   * "the effect fired twice" is not a thing this page should have to be
   * correct about.
   */
  const acted = useRef<string | null>(null);

  useEffect(() => {
    if (token === null || token === '') return;
    if (acted.current === token) return;
    acted.current = token;

    void (async () => {
      const response =
        purpose === 'unsubscribe'
          ? await consentApi.unsubscribe(token)
          : await consentApi.confirm(token);

      if (response.ok) {
        setResult(response.data);
      } else {
        /**
         * A transport or validation failure is shown as the same "no longer
         * valid" statement, for the same reason the server answers uniformly.
         * The one thing not to do is show a stack of technical detail to
         * somebody who is trying to opt out.
         */
        setFailed(true);
      }
    })();
  }, [purpose, token]);

  const copy = COPY[purpose];

  if (token === null || token === '') {
    return (
      <PublicNotice eyebrow={copy.eyebrow} heading={copy.missing} tone="refused">
        <NoticeBody>
          The address is missing the part that identifies you. Open the link straight from your
          email rather than typing it in, and it will work.
        </NoticeBody>
      </PublicNotice>
    );
  }

  if (result === null && !failed) {
    return (
      <PublicNotice eyebrow={copy.eyebrow} heading={copy.working}>
        {/*
         * Announced politely rather than silently: somebody using a screen
         * reader needs to know the page is doing something before the outcome
         * replaces it.
         */}
        <p role="status" className="text-sm text-muted">
          One moment.
        </p>
      </PublicNotice>
    );
  }

  const shown = present(purpose, result ?? { outcome: 'invalid', message: '' });

  return (
    <PublicNotice eyebrow={copy.eyebrow} heading={shown.heading} tone={shown.tone}>
      <NoticeBody>{shown.body}</NoticeBody>
      <p className="mt-8 text-sm">
        <Link
          to="/privacy"
          className="text-signal underline decoration-signal/40 underline-offset-4 hover:decoration-signal"
        >
          See or delete the data held about you
        </Link>
      </p>
    </PublicNotice>
  );
}

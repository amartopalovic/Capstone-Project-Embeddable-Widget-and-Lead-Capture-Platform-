import { useState, type FormEvent } from 'react';
import { PRIVACY_REQUEST_KIND_VALUES, type PrivacyRequestKindValue } from '@lcp/contracts';
import { privacyApi, type ApiFailure } from '../lib/api.js';
import { Alert, Button, Field } from '../components/ui.jsx';
import { NoticeBody, PublicNotice } from '../components/PublicNotice.jsx';

/**
 * Ask to see or delete your data (blueprint 4.8).
 *
 * The only page in this stage that is a form rather than a statement, and the
 * only one with a genuine two-step sequence behind it - ask here, confirm from
 * your inbox - so it is the only one that gets a step marker. Numbering
 * anything else would be decoration.
 *
 * The widget id is the awkward part of this flow and there is no way around it:
 * a person may have filled in forms for several different companies through
 * this platform, and 4.8 scopes a request to ONE workspace. The public widget
 * id is the only identifier they have ever seen, because it is in the snippet
 * on the page they filled in. The field explains where to find it rather than
 * pretending it is obvious.
 */

const KIND_COPY: Readonly<
  Record<
    PrivacyRequestKindValue,
    { readonly label: string; readonly detail: string; readonly warning?: string }
  >
> = {
  export: {
    label: 'Show me my data',
    detail: 'Everything this company holds about you, shown on the next page.',
  },
  deletion: {
    label: 'Delete my data',
    detail: 'Your details and everything you submitted are removed permanently.',
    /**
     * The consequence, separated from the description and the only red on the
     * page. A whole paragraph in danger red on an option nobody has chosen yet
     * shouts at everyone equally; one short sentence, in one colour, is read.
     */
    warning: 'This cannot be undone.',
  },
};

export function PrivacyRequestPage(): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [publicWidgetId, setPublicWidgetId] = useState('');
  const [kind, setKind] = useState<PrivacyRequestKindValue>('export');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSending(true);
    setFailure(null);

    const response = await privacyApi.start({ email, publicWidgetId, kind });
    setSending(false);
    if (response.ok) setSent(true);
    else setFailure(response);
  }

  /**
   * The same answer whether or not the address is a lead.
   *
   * Nothing on this page ever confirms that a given address has data in a given
   * workspace. Saying "no such contact" would let anybody test a list of
   * addresses against a company's leads one at a time - a worse privacy failure
   * than the one this flow exists to fix. The wording says "if", and means it.
   */
  if (sent) {
    return (
      <PublicNotice eyebrow="Step 2 of 2" heading="Check your email." tone="affirmed">
        <NoticeBody>
          If that address has data here, a confirmation link is on its way to it. Open the link to
          finish - it works once and expires in 24 hours.
        </NoticeBody>
        <NoticeBody>
          Nothing has happened yet. Confirming from your own inbox is what proves the address is
          yours.
        </NoticeBody>
      </PublicNotice>
    );
  }

  return (
    <PublicNotice
      eyebrow="Step 1 of 2"
      heading="See or delete your data."
      footer={
        <>
          This asks one company that uses Lead Capture. If you filled in forms for more than one,
          make a separate request for each.
        </>
      }
    >
      <NoticeBody>
        Tell us the address you used and which form you filled in. We will email you a link to
        confirm it is you.
      </NoticeBody>

      <form onSubmit={(event) => void submit(event)} noValidate className="mt-8 space-y-6">
        {failure !== null && <Alert tone="error">{failure.message}</Alert>}

        <Field
          label="Your email address"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <Field
          label="Form ID"
          mono
          required
          value={publicWidgetId}
          onChange={(event) => setPublicWidgetId(event.target.value)}
          hint="On the page where you filled in the form, this is the value beside data-widget in the embed code. It is also in the footer of emails you received."
        />

        <fieldset className="border-0 p-0">
          <legend className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
            What would you like to happen
          </legend>
          <div className="mt-3 space-y-2">
            {PRIVACY_REQUEST_KIND_VALUES.map((value) => (
              <label
                key={value}
                className={`flex cursor-pointer items-start gap-3 border p-4 ${
                  kind === value ? 'border-signal bg-paper' : 'border-edge bg-panel hover:bg-paper'
                }`}
              >
                <input
                  type="radio"
                  name="kind"
                  value={value}
                  checked={kind === value}
                  onChange={() => setKind(value)}
                  className="mt-1 accent-signal"
                />
                <span>
                  <span className="block text-sm font-medium text-ink">
                    {KIND_COPY[value].label}
                  </span>
                  <span className="mt-1 block text-sm text-muted">
                    {KIND_COPY[value].detail}{' '}
                    {KIND_COPY[value].warning !== undefined && (
                      <span className="font-medium text-danger">{KIND_COPY[value].warning}</span>
                    )}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <Button type="submit" disabled={sending}>
          {sending ? 'Sending' : 'Email me the link'}
        </Button>
      </form>
    </PublicNotice>
  );
}

import { Link } from 'react-router';
import { DOC_SECTIONS, DocSection, DocsShell, Note, Settings } from '../DocsShell.jsx';

/**
 * Consent, opt-in mode, and unsubscribe.
 *
 * The two rules that surprise people - a withdrawal outranks a later ticked
 * box, and an unticked box is not a withdrawal - are stated plainly rather than
 * left to be discovered. Both are deliberate, and somebody configuring this
 * needs to know which way they fail.
 */
export function ConsentDoc(): React.JSX.Element {
  return (
    <DocsShell
      sections={DOC_SECTIONS}
      navLabel="Documentation"
      title="Consent and unsubscribe"
      intro="How permission to email a lead is asked for, recorded, and withdrawn — and what happens when those disagree."
    >
      <DocSection title="Ask for consent">
        <p>
          Add a <strong className="font-medium text-ink">consent</strong> field to a widget in the
          builder, and write the label yourself. That label is the thing you are relying on later:
          proving consent means proving what somebody agreed to, not that a box was ticked, so the
          exact wording shown is copied into the record at the moment they submit.
        </p>
        <p>
          If a widget has no consent field, its leads are never marked as subscribed and no
          marketing email is sent to them. That is the safe default, and it needs no configuration.
        </p>
      </DocSection>

      <DocSection title="Single or double opt-in">
        <p>
          Set this once for the whole workspace, under Settings → Consent and retention. It applies
          to every widget.
        </p>
        <Settings
          rows={[
            {
              term: 'Double (default)',
              description:
                'A ticked box is a request, not permission. The address gets a confirmation email and is only subscribed once it is opened. Nothing marketing is sent before that.',
            },
            {
              term: 'Single',
              description:
                'A ticked box subscribes the address immediately. Faster, and appropriate where the tick is unambiguous — but you have no evidence the address belongs to the person who typed it.',
            },
          ]}
        />
        <p>
          Every marketing email carries an unsubscribe link. Confirmation emails do too, so somebody
          who never wanted to be asked can end it from the first message.
        </p>
      </DocSection>

      <DocSection title="Unsubscribe is workspace-wide, and it sticks">
        <p>
          One unsubscribe stops marketing email for that address across every widget in the
          workspace. Two things about it are worth knowing before you rely on it:
        </p>
        <ul className="ml-5 list-disc space-y-2">
          <li>
            <strong className="font-medium text-ink">A later ticked box does not undo it.</strong>{' '}
            If somebody unsubscribes and then fills in another of your forms with the consent box
            ticked, they stay unsubscribed. A ticked checkbox is weak evidence — it can be a
            default, a mis-click, or a form filled by somebody else — and a deliberate unsubscribe
            is strong evidence. They can subscribe again, but only by confirming from the address
            itself.
          </li>
          <li>
            <strong className="font-medium text-ink">It survives the lead being deleted.</strong>{' '}
            The suppression record is kept separately from the contact and stores a one-way
            fingerprint of the address rather than the address. So deleting a lead does not
            accidentally re-enable mail to them the next time they submit.
          </li>
        </ul>

        <Note>
          An unticked box is <em>not</em> an unsubscribe. Somebody who confirmed last month and
          submits a support form today without ticking anything has not asked to be removed — they
          simply have not asked to be added again.
        </Note>
      </DocSection>

      <DocSection title="Transactional email is never suppressed">
        <p>
          The confirmation a visitor gets after submitting a form answers something they just did,
          so it is sent whether or not they are subscribed to marketing. Team notifications to your
          own inbox are likewise unaffected — they are not addressed to the lead at all.
        </p>
      </DocSection>

      <DocSection title="What a lead can do without an account">
        <p>
          Anyone who has filled in one of your forms can ask to see everything you hold about them,
          or have it deleted, by confirming from their own inbox. There is a public page for it at{' '}
          <Link
            to="/privacy"
            className="text-signal underline decoration-signal/40 underline-offset-4 hover:decoration-signal"
          >
            /privacy
          </Link>
          , and the link is in the footer of every page.
        </p>
        <p>
          A deletion is immediate and cannot be undone — it does not go to the 30-day trash, because
          somebody exercising a data right has already confirmed it. Their record and the values
          they submitted are erased; only the unsubscribe fingerprint remains, so you do not start
          mailing them again.
        </p>
      </DocSection>

      <DocSection title="Retention">
        <p>
          Also under Settings → Consent and retention. Leads with no activity for longer than the
          chosen period are permanently anonymised on a daily sweep. The clock runs from the last
          time the lead submitted something or somebody on your team worked on them — not from when
          they first arrived, so an active lead is never retired mid-conversation.
        </p>
        <Settings
          rows={[
            { term: 'Choices', description: '30 days, 90 days, 12 months, or indefinitely.' },
            { term: 'Default', description: '12 months.' },
            {
              term: 'Changing it',
              description:
                'Takes effect on the next daily sweep. Shortening it is warned about before you save, because it schedules the destruction of leads you already have.',
            },
          ]}
        />
      </DocSection>
    </DocsShell>
  );
}

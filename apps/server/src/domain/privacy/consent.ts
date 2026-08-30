import { createHash } from 'node:crypto';
import type { ConsentState, OptInMode } from '@lcp/database';

/**
 * The marketing consent state machine (blueprint 4.8).
 *
 * Pure, so every transition below is testable without a database, an email
 * provider, or a clock. The service layer decides what to persist and what to
 * send; this decides what the state BECOMES, which is the part that has to be
 * right.
 */

/** What can happen to a contact's consent. */
export type ConsentTransition =
  /** A submission arrived with the consent box ticked. */
  | { readonly kind: 'form_opt_in' }
  /** A submission arrived with the box present and unticked. */
  | { readonly kind: 'form_declined' }
  /** The address followed the double opt-in link. */
  | { readonly kind: 'confirmed' }
  /** The address followed an unsubscribe link, or completed a deletion. */
  | { readonly kind: 'withdrawn' };

export interface ConsentOutcome {
  readonly state: ConsentState;
  /** Whether a double opt-in confirmation email should now be sent. */
  readonly sendConfirmation: boolean;
  /** Whether the address should be added to the suppression list. */
  readonly suppress: boolean;
  /** Whether an existing suppression should be lifted. */
  readonly release: boolean;
}

/**
 * Resolve the next consent state.
 *
 * Two rules here are decisions rather than mechanics, and both are deliberately
 * the conservative reading of 4.8:
 *
 * **Withdrawal is terminal against forms.** A contact who unsubscribed and
 * later submits another form with the box ticked stays withdrawn. A ticked
 * checkbox is weak evidence - it can be a default, a mis-click, or a form
 * filled by somebody else - and a deliberate unsubscribe is strong evidence.
 * Letting the weak signal silently overturn the strong one would make the
 * unsubscribe a temporary inconvenience rather than a promise. They can opt in
 * again, but only by confirming from the address itself.
 *
 * **An unticked box is not a withdrawal.** Somebody who confirmed last month
 * and submits a support form today without ticking a marketing box has not
 * asked to be removed; they simply did not ask to be added again. Treating
 * silence as withdrawal would unsubscribe people who never asked to be.
 */
export function nextConsent(
  current: ConsentState,
  transition: ConsentTransition,
  mode: OptInMode,
): ConsentOutcome {
  const unchanged: ConsentOutcome = {
    state: current,
    sendConfirmation: false,
    suppress: false,
    release: false,
  };

  switch (transition.kind) {
    case 'form_opt_in': {
      // A deliberate unsubscribe outranks a ticked box. See above.
      if (current === 'withdrawn') return unchanged;
      // Already confirmed: nothing to do, and no second confirmation email.
      if (current === 'confirmed') return unchanged;

      if (mode === 'single') {
        return { state: 'confirmed', sendConfirmation: false, suppress: false, release: true };
      }
      /**
       * Double opt-in re-sends the confirmation for a contact who is already
       * pending. That is intended: the first email may have been lost, and the
       * alternative is a contact stuck in `pending` forever with no way out.
       * The send itself is rate-limited at the service boundary.
       */
      return { state: 'pending', sendConfirmation: true, suppress: false, release: false };
    }

    case 'form_declined':
      // Silence is not withdrawal, and it does not undo a confirmation, so
      // every current state survives an unticked box untouched.
      return unchanged;

    case 'confirmed': {
      // Only a pending request can be confirmed. A link followed twice, or one
      // followed after an unsubscribe, must not resurrect consent.
      if (current !== 'pending') return unchanged;
      return { state: 'confirmed', sendConfirmation: false, suppress: false, release: true };
    }

    case 'withdrawn':
      return { state: 'withdrawn', sendConfirmation: false, suppress: true, release: false };

    default:
      return unchanged;
  }
}

/** Whether marketing mail may be sent, before the suppression list is consulted. */
export function mayReceiveMarketing(state: ConsentState): boolean {
  return state === 'confirmed';
}

/**
 * A stable fingerprint of the consent wording (blueprint 4.8: "text/version").
 *
 * Derived from the text rather than maintained by hand. A version number
 * somebody has to remember to bump is a version number that silently goes
 * stale the first time a label is reworded, and the whole point of storing a
 * version is to prove which sentence a contact agreed to. Twelve hex characters
 * is ample to distinguish the handful of wordings one workspace will ever use,
 * and short enough to read in a timeline.
 */
export function consentTextVersion(text: string): string {
  return createHash('sha256')
    .update(text.trim().replace(/\s+/g, ' '), 'utf8')
    .digest('hex')
    .slice(0, 12);
}

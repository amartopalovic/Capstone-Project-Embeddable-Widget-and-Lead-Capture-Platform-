import { describe, expect, it } from 'vitest';
import {
  consentTextVersion,
  mayReceiveMarketing,
  nextConsent,
} from '../src/domain/privacy/consent.js';
import { signConsentLink, verifyConsentLink } from '../src/domain/privacy/links.js';
import { suppressionKey } from '../src/domain/privacy/suppression.js';
import {
  isBeyondRetention,
  isPurgeable,
  isRecoverable,
  purgeDeadline,
  retentionDeadline,
  RECOVERY_WINDOW_DAYS,
} from '../src/domain/workspace/retention.js';

/**
 * The pure halves of Stage 11 (blueprint 4.8, 9.5).
 *
 * Every rule that decides whether somebody gets marketing mail, or whether a
 * record may be destroyed, is a pure function - so it can be pinned here
 * without a database, an email provider, or a real clock. The service tests
 * then only have to prove the wiring.
 */

const SECRET = 'unit-test-master-secret-not-a-real-one';
const WORKSPACE = '65f000000000000000000001';
const CONTACT = '65f000000000000000000002';

// ===========================================================================
// The consent state machine
// ===========================================================================

describe('the consent state machine (blueprint 4.8)', () => {
  it('single opt-in subscribes a ticked box straight away', () => {
    const outcome = nextConsent('none', { kind: 'form_opt_in' }, 'single');
    expect(outcome.state).toBe('confirmed');
    expect(outcome.sendConfirmation).toBe(false);
  });

  it('double opt-in makes a ticked box pending and asks for confirmation', () => {
    const outcome = nextConsent('none', { kind: 'form_opt_in' }, 'double');
    expect(outcome.state).toBe('pending');
    expect(outcome.sendConfirmation).toBe(true);
  });

  it('confirms a pending contact, and only a pending one', () => {
    expect(nextConsent('pending', { kind: 'confirmed' }, 'double').state).toBe('confirmed');
    // Never asked: a confirmation link cannot manufacture consent that was
    // never requested.
    expect(nextConsent('none', { kind: 'confirmed' }, 'double').state).toBe('none');
  });

  it('does not let a confirmation link resurrect a withdrawn subscription', () => {
    /**
     * The scenario this guards: somebody unsubscribes, then clicks the older
     * confirmation link still sitting in their inbox. Honouring it would
     * silently re-subscribe a person who had already said no.
     */
    expect(nextConsent('withdrawn', { kind: 'confirmed' }, 'double').state).toBe('withdrawn');
  });

  it('keeps a withdrawal against a later ticked box', () => {
    /**
     * The most consequential rule in the file. A ticked checkbox is weak
     * evidence and a deliberate unsubscribe is strong evidence, so the weak
     * signal never overturns the strong one.
     */
    const outcome = nextConsent('withdrawn', { kind: 'form_opt_in' }, 'double');
    expect(outcome.state).toBe('withdrawn');
    expect(outcome.sendConfirmation).toBe(false);
    expect(outcome.release).toBe(false);
  });

  it('treats an unticked box as silence, not as a withdrawal', () => {
    // Somebody who confirmed last month and files a support form today has
    // not asked to be removed.
    expect(nextConsent('confirmed', { kind: 'form_declined' }, 'double').state).toBe('confirmed');
    expect(nextConsent('pending', { kind: 'form_declined' }, 'double').state).toBe('pending');
    expect(nextConsent('none', { kind: 'form_declined' }, 'double').suppress).toBe(false);
  });

  it('suppresses on withdrawal from any state', () => {
    for (const state of ['none', 'pending', 'confirmed'] as const) {
      const outcome = nextConsent(state, { kind: 'withdrawn' }, 'double');
      expect(outcome.state).toBe('withdrawn');
      expect(outcome.suppress).toBe(true);
    }
  });

  it('re-sends the confirmation for a contact already pending', () => {
    // The first email may have been lost; the alternative is a contact stuck
    // in pending forever with no way to complete.
    expect(nextConsent('pending', { kind: 'form_opt_in' }, 'double').sendConfirmation).toBe(true);
  });

  it('does not email a contact who is already confirmed', () => {
    expect(nextConsent('confirmed', { kind: 'form_opt_in' }, 'double').sendConfirmation).toBe(
      false,
    );
  });

  it('permits marketing only in the confirmed state', () => {
    expect(mayReceiveMarketing('confirmed')).toBe(true);
    for (const state of ['none', 'pending', 'withdrawn'] as const) {
      expect(mayReceiveMarketing(state)).toBe(false);
    }
  });
});

describe('consent text versions (blueprint 4.8)', () => {
  it('gives the same wording the same version', () => {
    expect(consentTextVersion('Email me about offers')).toBe(
      consentTextVersion('Email me about offers'),
    );
  });

  it('ignores whitespace differences that do not change the meaning', () => {
    expect(consentTextVersion('Email me  about offers')).toBe(
      consentTextVersion(' Email me about offers '),
    );
  });

  it('gives reworded consent a different version', () => {
    expect(consentTextVersion('Email me about offers')).not.toBe(
      consentTextVersion('Email me about offers and partner offers'),
    );
  });
});

// ===========================================================================
// Signed consent links
// ===========================================================================

describe('signed consent links (blueprint 4.8)', () => {
  it('round-trips the claims it was built from', () => {
    const token = signConsentLink(SECRET, {
      purpose: 'unsubscribe',
      workspaceId: WORKSPACE,
      contactId: CONTACT,
    });
    expect(verifyConsentLink(SECRET, token)).toEqual({
      purpose: 'unsubscribe',
      workspaceId: WORKSPACE,
      contactId: CONTACT,
    });
  });

  it('refuses a token signed with a different secret', () => {
    const token = signConsentLink(SECRET, {
      purpose: 'unsubscribe',
      workspaceId: WORKSPACE,
      contactId: CONTACT,
    });
    expect(verifyConsentLink('a-different-secret', token)).toBeNull();
  });

  it('refuses a token whose payload was edited', () => {
    /**
     * The attack this closes: take your own valid unsubscribe link, swap the
     * contact id for somebody else's, and unsubscribe them. The signature
     * covers both ids together, so the edit invalidates it.
     */
    const token = signConsentLink(SECRET, {
      purpose: 'unsubscribe',
      workspaceId: WORKSPACE,
      contactId: CONTACT,
    });
    const [, signature] = token.split('.');
    const forged = Buffer.from(
      `unsubscribe:${WORKSPACE}:65f0000000000000000000ff`,
      'utf8',
    ).toString('base64url');
    expect(verifyConsentLink(SECRET, `${forged}.${signature ?? ''}`)).toBeNull();
  });

  it('separates the two purposes, so an unsubscribe link cannot confirm', () => {
    const unsubscribe = signConsentLink(SECRET, {
      purpose: 'unsubscribe',
      workspaceId: WORKSPACE,
      contactId: CONTACT,
    });
    const confirm = signConsentLink(SECRET, {
      purpose: 'confirm',
      workspaceId: WORKSPACE,
      contactId: CONTACT,
    });
    expect(unsubscribe).not.toBe(confirm);
    expect(verifyConsentLink(SECRET, unsubscribe)?.purpose).toBe('unsubscribe');
    expect(verifyConsentLink(SECRET, confirm)?.purpose).toBe('confirm');
  });

  it('refuses malformed tokens without throwing', () => {
    for (const bad of ['', '.', 'nodot', 'a.', '.b', 'not-base64!.sig', 'aGVsbG8.sig']) {
      expect(verifyConsentLink(SECRET, bad)).toBeNull();
    }
  });
});

// ===========================================================================
// Suppression keys
// ===========================================================================

describe('suppression keys (blueprint 4.8, 9.4)', () => {
  it('is stable for the same address in the same workspace', () => {
    expect(suppressionKey(SECRET, WORKSPACE, 'lead@example.invalid')).toBe(
      suppressionKey(SECRET, WORKSPACE, 'LEAD@example.invalid'),
    );
  });

  it('differs across workspaces for the same address', () => {
    /**
     * Suppression is workspace-wide, not global. Identical keys across tenants
     * would let two workspaces compare lists to discover they share a lead.
     */
    const other = '65f0000000000000000000aa';
    expect(suppressionKey(SECRET, WORKSPACE, 'lead@example.invalid')).not.toBe(
      suppressionKey(SECRET, other, 'lead@example.invalid'),
    );
  });

  it('never contains the address it was derived from', () => {
    const key = suppressionKey(SECRET, WORKSPACE, 'lead@example.invalid');
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain('lead');
    expect(key).not.toContain('example');
  });
});

// ===========================================================================
// Retention windows - the exit gate's arithmetic
// ===========================================================================

const DAY = 24 * 60 * 60 * 1000;
const DELETED_AT = new Date('2026-06-01T12:00:00.000Z');

describe('the 30-day recovery window (blueprint 9.5)', () => {
  const deadline = purgeDeadline(DELETED_AT);

  it('falls exactly 30 days after deletion', () => {
    expect(deadline.getTime()).toBe(DELETED_AT.getTime() + RECOVERY_WINDOW_DAYS * DAY);
  });

  it('is still recoverable one millisecond before the deadline', () => {
    const justBefore = new Date(deadline.getTime() - 1);
    expect(isRecoverable(deadline, justBefore)).toBe(true);
    expect(isPurgeable(deadline, justBefore)).toBe(false);
  });

  it('is purgeable exactly at the deadline, and not a moment sooner', () => {
    expect(isRecoverable(deadline, deadline)).toBe(false);
    expect(isPurgeable(deadline, deadline)).toBe(true);
  });

  it('stays purgeable afterwards', () => {
    const later = new Date(deadline.getTime() + 5 * DAY);
    expect(isPurgeable(deadline, later)).toBe(true);
  });

  it('never purges a record with no deadline', () => {
    /**
     * A soft-deleted record with a null deadline is missing data, and a sweep
     * must read missing data as "leave it alone" rather than as permission to
     * destroy it.
     */
    expect(isPurgeable(null, new Date('2099-01-01T00:00:00.000Z'))).toBe(false);
    expect(isRecoverable(null, DELETED_AT)).toBe(false);
  });
});

describe('active-contact retention (blueprint 9.5, 4.8)', () => {
  const anchor = new Date('2026-01-15T09:00:00.000Z');

  it('computes the deadline from the anchor, not from creation', () => {
    expect(retentionDeadline(anchor, 90)?.getTime()).toBe(anchor.getTime() + 90 * DAY);
  });

  it('has no deadline at all when retention is indefinite', () => {
    expect(retentionDeadline(anchor, 0)).toBeNull();
    expect(isBeyondRetention(anchor, 0, new Date('2099-01-01T00:00:00.000Z'))).toBe(false);
  });

  it('keeps a contact for the whole of its final day', () => {
    const deadline = retentionDeadline(anchor, 30);
    if (deadline === null) throw new Error('expected a deadline');
    expect(isBeyondRetention(anchor, 30, new Date(deadline.getTime() - 1))).toBe(false);
    expect(isBeyondRetention(anchor, 30, deadline)).toBe(true);
  });

  it('applies each of the four offered presets', () => {
    for (const days of [30, 90, 365] as const) {
      const deadline = retentionDeadline(anchor, days);
      expect(deadline?.getTime()).toBe(anchor.getTime() + days * DAY);
    }
    expect(retentionDeadline(anchor, 0)).toBeNull();
  });
});

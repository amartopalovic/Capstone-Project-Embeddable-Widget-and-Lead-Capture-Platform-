import { createHmac } from 'node:crypto';

/**
 * The suppression-list key (blueprint 4.8, 9.4).
 *
 * Blueprint 4.8 lets "minimal suppression data" survive an email-verified
 * deletion so the unsubscribe keeps being honored. Minimal is the operative
 * word: storing the address itself would leave a deleted contact's email
 * sitting in a table, which is not deletion by any reasonable reading.
 *
 * A keyed HMAC rather than a bare hash, for the same reason the IP pseudonym
 * uses one - the set of real email addresses is enumerable enough that an
 * unkeyed digest of a suppression list could be dictionary-attacked back into
 * the addresses it was meant to protect. With the master secret in the HMAC,
 * the list only answers questions about an address the asker already has.
 *
 * Scoped per workspace, because suppression is workspace-wide and not global:
 * unsubscribing from one customer's mail says nothing about another's, and
 * identical keys across tenants would let two workspaces compare lists to learn
 * that they share a lead.
 *
 * The label is what separates this key from `ip-pseudonym:` and
 * `visitor-pseudonym:`, so the same address never produces the same value in
 * two different systems.
 */
export function suppressionKey(
  masterSecret: string,
  workspaceId: string,
  normalizedEmail: string,
): string {
  const key = createHmac('sha256', masterSecret).update('suppression-key').digest();
  return createHmac('sha256', key)
    .update(`${workspaceId}|${normalizedEmail.trim().toLowerCase()}`)
    .digest('hex');
}

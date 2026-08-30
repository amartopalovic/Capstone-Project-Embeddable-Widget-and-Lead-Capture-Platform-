# Secret rotation and key versions

An operational runbook for rotating every piece of key material this platform holds, written so
that somebody who did not build it can do it without breaking data that already exists.

Blueprint 13 asks for this document by name. It exists because two of the secrets below have
consequences that are not obvious from reading the code, and one of them is irreversible.

Nothing in this file is a secret. Every value is named, never quoted.

---

## The short version

| Secret                  | Rotating it breaks                                            | Recoverable?                    |
| ----------------------- | ------------------------------------------------------------- | ------------------------------- |
| `SESSION_SECRET`        | Every signed-in session and every open CSRF token             | Yes — sign in again             |
| `ENCRYPTION_MASTER_KEY` | Every stored webhook signing secret and TOTP secret           | **Only if the old key is kept** |
| `IP_HMAC_SECRET`        | Every unsubscribe link ever emailed, and the suppression list | **No**                          |
| `BREVO_API_KEY`         | Outbound email until the new key is deployed                  | Yes                             |
| `SENTRY_DSN`            | Error reporting until the new DSN is deployed                 | Yes                             |
| Database / Redis URLs   | Everything, until deployed                                    | Yes                             |

Read the section for a secret before rotating it. `IP_HMAC_SECRET` in particular is not a secret
you can rotate on a schedule without accepting a real cost.

---

## `SESSION_SECRET`

**What uses it.** It signs CSRF tokens (`csrf-csrf`, wired in `http/app.ts`). Session identity
itself lives in Redis, not in a signed cookie, so this secret does not encrypt any stored data.

**What rotating it does.** Every CSRF token minted under the old secret stops verifying. A user
part-way through a form gets one 403 and a page reload fixes it. Nothing is lost and nothing needs
migrating.

**Procedure.**

1. Generate: `openssl rand -base64 48`.
2. Set `SESSION_SECRET` in the environment and redeploy.
3. Optionally revoke sessions as well — see below. Rotating this secret alone does **not** sign
   anybody out, because sessions are server-side.

**To actually sign everybody out**, delete the session keys from Redis. They are namespaced by
`REDIS_KEY_PREFIX`, so `<prefix>:session:*` is the set to remove; per-user indexes live beside them
and the same prefix covers both.

---

## `ENCRYPTION_MASTER_KEY` and `ENCRYPTION_KEY_VERSION`

**What uses it.** AES-256-GCM encryption of readable secrets: webhook signing secrets and TOTP
secrets. See `infrastructure/auth/aes-secret-cipher.ts`. Every ciphertext records the key **version**
that produced it, so more than one key can be live at once.

**The trap.** Setting a new `ENCRYPTION_MASTER_KEY` without keeping the old one makes every existing
ciphertext undecryptable — permanently. GCM is authenticated encryption; there is no partial
recovery. In practice that means every configured webhook stops signing and every user with MFA
enabled is locked out of their second factor.

That is what `ENCRYPTION_PREVIOUS_KEYS` exists to prevent.

**Procedure — rotate without touching existing data.**

1. Generate a new 32-byte key: `openssl rand -base64 32`.
2. Move the **current** key into the retired list, keeping its version number:

   ```
   ENCRYPTION_PREVIOUS_KEYS=1:<the key that is currently ENCRYPTION_MASTER_KEY>
   ENCRYPTION_MASTER_KEY=<the new key>
   ENCRYPTION_KEY_VERSION=2
   ```

3. Deploy. From this moment new values encrypt under version 2; anything written under version 1
   still decrypts, because version 1 is still in the map.
4. Verify before removing anything: a webhook delivery to an endpoint configured before the
   rotation should still be signed, and a user with MFA should still be able to sign in.

**Procedure — retire the old key.** Only once nothing is still encrypted under it.

1. Re-save every webhook endpoint's signing secret and re-enrol MFA, which rewrites those values
   under the current version. There is no bulk re-encryption command; version 1 of this product has
   few enough of these records that doing it deliberately is safer than a migration nobody has run.
2. Remove that version from `ENCRYPTION_PREVIOUS_KEYS` and deploy.
3. Keep the removed key somewhere retrievable for as long as any backup taken before step 1 is
   still in retention. A restored backup is ciphertext under the old key.

**If the key is lost.** There is no recovery. Delete and recreate the affected webhook endpoints and
have every MFA user re-enrol. Contacts, submissions, and analytics are unaffected — none of them is
encrypted at rest by this key.

---

## `IP_HMAC_SECRET`

Read this section before rotating. It is the one with a cost that cannot be undone.

**What uses it.** Despite the name it is the master secret for four derived key families, each with
its own label so the same input never produces the same output in two of them:

| Derived key              | Where                                   | What it protects                                            |
| ------------------------ | --------------------------------------- | ----------------------------------------------------------- |
| `ip-pseudonym:<YYYY-MM>` | `domain/submission/ip-pseudonym.ts`     | The rotating visitor pseudonym; the raw IP is never stored  |
| `visitor-pseudonym:`     | `domain/analytics/visitor-pseudonym.ts` | Funnel-level visitor identity                               |
| `consent-link`           | `domain/privacy/links.ts`               | The signature on every unsubscribe and double-opt-in link   |
| suppression keys         | `domain/privacy/suppression.ts`         | The per-workspace suppression list, which survives deletion |

**What rotating it does.**

- **Every unsubscribe link already in somebody's inbox stops working.** These links are stateless
  and signed rather than stored — deliberately, so they never expire and never get consumed — which
  means their validity depends entirely on this secret. Stage 11 documented this consequence; this
  is the runbook entry it was pointing at. A dead unsubscribe link is the single worst failure a
  consent system can have, and in several jurisdictions it is also a compliance one.
- **The suppression list is orphaned.** Entries are keyed by HMAC of the address. After rotation the
  same address hashes differently, so previously suppressed people are no longer recognised as
  suppressed and can be emailed again.
- Visitor pseudonyms change, which is harmless: they already rotate monthly by design, and the
  period travels with each stored value.

**The monthly rotation is already built in and needs no action.** `ip-pseudonym` derives a fresh
subkey each calendar month from this master secret. That is the rotation blueprint 9.4 requires, and
it happens on its own. Rotating the master secret is a different and much heavier operation.

**When you must rotate it anyway** — because it leaked:

1. Accept that outstanding unsubscribe links will break. There is no migration that preserves them;
   re-signing would require knowing every link ever sent.
2. Before rotating, export the suppression collection. After rotating, re-derive each entry from the
   address it came from — which is possible only if you still hold those addresses. For contacts
   deleted under blueprint 4.8 you do not, and those suppressions are unrecoverable.
3. Rotate, deploy, and send a re-permission message to affected lists rather than silently
   continuing to mail people whose suppression you can no longer see.
4. Treat step 3 as mandatory. It is the only honest outcome.

**Design note for a future stage.** Splitting this into two secrets — one for pseudonyms, one for
consent-link signatures — would make the pseudonym half rotatable without touching the consent half.
It is not done here because it is a data-format change, not a hardening change, and Stage 13 does
not change product behaviour. It is recorded in `EVIDENCE.md` as a known limitation.

---

## `BREVO_API_KEY`

**What rotating it does.** Nothing, once deployed. It is an outbound credential with no stored
derivative.

**Procedure.** Create the new key in Brevo, deploy it, then delete the old key in Brevo — in that
order, so there is no window with no working key. Confirm with `GET /health/ready`: the `optional`
section reports the email provider, and a misconfigured one shows as `degraded` there rather than
failing silently.

---

## `SENTRY_DSN` and `VITE_SENTRY_DSN`

A DSN is not a credential in the usual sense: it is embedded in the browser bundle of every
application that uses one, and it grants only the ability to send events. Rotate it by creating a new
project key in Sentry and deploying both variables. `GET /health/ready` reports
`error-monitoring: degraded` while none is configured.

Both must move together, and `VITE_RELEASE` must keep matching `RELEASE`, or a browser error and the
API error that caused it land under two different releases and nobody connects them.

---

## `PLATFORM_OPERATOR_EMAILS`

Not a secret — it is a list of addresses, and the diagnostics surface it guards authenticates the
**person** through the ordinary session, not the list. Remove an address and that person loses access
at their next request; there is no token to revoke and no redeploy race where an old credential still
works.

Leaving it empty closes `GET /api/v1/diagnostics` to everybody, which is the default.

---

## Database and Redis credentials

**MongoDB Atlas.** Create a second database user, deploy `MONGODB_URI` pointed at it, confirm
`GET /health/ready` reports `mongodb: up`, then delete the first user. Never delete first: the
service has no fallback and readiness will report `not_ready` for the whole window.

**Upstash Redis.** Rotating the password invalidates every session, every rate-limit counter, and
every queued BullMQ job that has not been persisted to its Mongo outbox row. Sessions and counters
are expected losses. Queued work is not: before rotating, let the queues drain — `GET
/api/v1/diagnostics` reports each family's depth and the age of its oldest waiting job, which is the
figure to watch — and confirm the outbox reconciler has settled.

---

## Deployment headers, which are not a secret but are easy to lose

The two front-end applications carry their Content Security Policy in a `<meta>` tag, so it travels
with the document wherever it is hosted. Three headers cannot be delivered that way and must be sent
by whatever serves those files:

- `X-Frame-Options: DENY` and the CSP's `frame-ancestors` directive — a browser **ignores**
  `frame-ancestors` in a meta tag, so clickjacking protection for the static applications depends
  entirely on a response header;
- `Permissions-Policy`;
- `Strict-Transport-Security`.

The dev and preview servers send all of them (`@lcp/config/vite-security-headers`), and Express sends
them for everything it serves. A static host that sends none of them leaves the two front-end
applications framable. Stage 14 owns configuring that host; this note exists so it is not discovered
afterwards.

---

## After any rotation

1. `GET /health/ready` — required dependencies `up`, and read the `optional` section rather than
   assuming.
2. `GET /api/v1/diagnostics` as a platform operator — queue depths flat, dead letters not climbing.
3. Send one real email through the affected path. A verification email is the cheapest end-to-end
   proof that the email provider, the queue, and the link signing all still work together.

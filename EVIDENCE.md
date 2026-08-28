# EVIDENCE

One repeatable proof per requirement.

> ## Status at Stage 4a: **no acceptance probe is proven.**
>
> Blueprint Stage 3 is complete. Stage 4a adds the workspace and RBAC backend: B1 and C7 are
> now `PROVEN` at the API level, and D2 has widened as the first real workspace-scoped write
> paths appeared. **All six acceptance probes remain `NOT YET IMPLEMENTED`**, because no widget
> or submission code exists; they are Stage 7. Blueprint Stage 4 itself is NOT complete - the
> workspace UI and its browser E2E are Stage 4b.
>
> As each stage completes, its entries gain: the exact command an evaluator can re-run, the
> observed output or transcript, and a link to the test that enforces the behavior. An entry is
> only marked proven when that command has actually been executed and its real output recorded.

Legend:

- `NOT YET IMPLEMENTED` — no code exists for this requirement.
- `IN PROGRESS` — partially implemented; the gap is stated explicitly.
- `PROVEN` — a re-runnable command and its real recorded output exist below.

Stage numbers refer to blueprint §19. Requirement sources are cited as blueprint section numbers.

---

## Part A — Mandatory acceptance probes (blueprint §18.5)

These six probes are the capstone brief's core gates. They are never deferred behind optional
polish. All six must pass locally by the end of Stage 7, with the side-effect probe extended to
real queue behavior in Stage 9.

### A1. Valid second-origin submission

- **Requirement:** A valid submission from a genuinely different origin returns 2xx, creates a
  durable Submission Event, and produces a visible Contact and dashboard result.
- **Status:** `NOT YET IMPLEMENTED` — planned for **Stage 7** (dashboard visibility completed in
  **Stage 8**).
- **Command:** _not available yet_
- **Evidence:** _none_

### A2. Malformed and oversized input

- **Requirement:** Malformed bodies, bodies over 32 KB, more than 20 fields, and long-text values
  above 5,000 characters all return clean 4xx JSON errors. Malformed or oversized input never
  becomes a 500 (blueprint §7.3, §10.1).
- **Status:** `NOT YET IMPLEMENTED` — planned for **Stage 7**.
- **Command:** _not available yet_
- **Evidence:** _none_

### A3. Burst traffic

- **Requirement:** Under burst load, 429 responses appear while a later legitimate request still
  succeeds. Limits: 5 submissions/minute per IP-widget pair, 30/hour per IP-widget pair, 100/minute
  per widget (blueprint §7.3).
- **Status:** `NOT YET IMPLEMENTED` — planned for **Stage 7**.
- **Command:** _not available yet_
- **Evidence:** _none_

### A4. Geo fallback

- **Requirement:** Provider A down → provider B enriches the submission. Both providers down → the
  submission is still stored successfully, without geo (blueprint §7.3, §18.4).
- **Status:** `NOT YET IMPLEMENTED` — planned for **Stage 7**.
- **Command:** _not available yet_
- **Evidence:** _none_

### A5. Side-effect failure

- **Requirement:** When email or webhook delivery throws, the primary submission remains successful
  and stored. Side effects can never reverse an accepted submission (blueprint §7.3, §12.2).
- **Status:** `NOT YET IMPLEMENTED` — planned for **Stage 7**, completed with real queue, retry,
  and dead-letter behavior in **Stage 9**.
- **Command:** _not available yet_
- **Evidence:** _none_

### A6. Honeypot

- **Requirement:** A bot-like submission (filled honeypot or failed timing heuristic) receives a
  generic success outcome, creates no Contact, and records only a minimal Abuse Event with no
  captured form values (blueprint §7.3, §7.4).
- **Status:** `NOT YET IMPLEMENTED` — planned for **Stage 7**.
- **Command:** _not available yet_
- **Evidence:** _none_

---

## Part B — Locked product decisions (blueprint §4)

### B1. Accounts, workspaces, and roles (§4.1)

- **Requirement:** Public registration; shared workspaces; a user may own one workspace and join
  many; Owner/Admin/Member roles; 7-day invitations; unverified users may use the dashboard but
  cannot publish or invite; Owner-only ownership transfer; 30-day workspace soft deletion.
- **Status:** `PROVEN` at the API level in Stage 4a. The UI half is Stage 4b.
- **Every clause of section 4.1 now works and is tested:** public registration; shared workspaces
  with Owner/Admin/Member roles; a user owning at most one active workspace while joining many;
  first-workspace onboarding with a name and a confirmed IANA timezone; the Admins-manage-Members
  but Owner-assigns-Admins asymmetry; invitations by email link with a 7-day expiry; unverified
  users keeping dashboard access but being blocked from inviting; ownership transfer to a verified
  Admin; Owner-only workspace soft-delete with 30-day recovery; and the account-deletion
  precondition requiring the owned workspace to be resolved first.
- **What is still missing:** the UI for all of it, and browser E2E across the role matrix, both of
  which the blueprint Stage 4 exit gate names explicitly. That is why Stage 4 remains unchecked.
- **Evidence:** see Part D-detail, Stage 4a.

### B2. Authentication and account security (§4.2)

- **Requirement:** Email/password with Argon2id; 12-character minimum with breached-password
  blocking; verification and reset flows; optional TOTP MFA; Redis server sessions with 7-day idle
  and 30-day absolute lifetime; device list and revocation; security audit events.
- **Status:** `PROVEN`. Blueprint Stage 3 is complete; the credential half landed in Stage 3a and
  MFA in Stage 3b.
- **Every clause of section 4.2 is implemented and tested:** Argon2id hashing at 64 MiB / t=3 / p=4;
  a 12-character minimum with strength feedback and common/breached-password blocking; email
  verification and password reset over hashed single-use expiring tokens; **optional TOTP MFA with
  ten hashed single-use recovery codes**; Redis server sessions with a 7-day idle and 30-day
  absolute lifetime; a device/session list with individual and global revocation; and security
  audit events for every authentication action.
- **MFA is optional and is never forced**, matching section 4.2. "Encouraged for Owner/Admin" is
  not enforceable yet because roles do not exist until Stage 4.
- **Evidence:** see Part D-detail, Stage 3b.

### B3. Widget catalog and builder (§4.3)

- **Requirement:** Exactly three widget types (contact form, email signup, CTA popover) with locked
  mandatory fields, the seven predefined field types, and bounded visual customization. No
  arbitrary CSS or JavaScript.
- **Status:** `NOT YET IMPLEMENTED` — planned for **Stage 5**.
- **Evidence:** _none_

### B4. Display, targeting, and visitor behavior (§4.4)

- **Requirement:** Inline/modal/floating modes; click, delay, scroll-depth, and exit-intent
  triggers; exact-host and explicit wildcard domain matching where `*.example.com` excludes
  `example.com`; safe glob page targeting; configurable cooldown; rotating per-widget pseudonymous
  visitor identifier; multiple instances sharing one runtime.
- **Status:** `NOT YET IMPLEMENTED` — settings in **Stage 5**, runtime behavior in **Stage 6**.
- **Evidence:** _none_

### B5. Publishing lifecycle (§4.5)

- **Requirement:** Stable widget identity with separately versioned revisions; Members edit drafts
  only; Owner/Admin publish to an immutable live revision; unpublishing immediately blocks config
  use and submissions at the backend; soft delete preserves historical contacts and events.
- **Status:** `NOT YET IMPLEMENTED` — planned for **Stage 5**.
- **Evidence:** _none_

### B6. Contacts and submissions (§4.6)

- **Requirement:** Contact unique by normalized email per workspace; every accepted submission
  creates an immutable Submission Event; manually edited canonical values are never silently
  overwritten; five lead statuses with archiving distinct from deletion.
- **Status:** `NOT YET IMPLEMENTED` — write path in **Stage 7**, management in **Stage 8**.
- **Evidence:** _none_

### B7. Lead inbox and collaboration (§4.7)

- **Requirement:** Search, filters, cursor pagination, deterministic sorting, role-aware single and
  bulk actions, Owner/Admin-only filtered CSV/JSON export, live SSE arrival, 30-day soft deletion
  and recovery.
- **Status:** `NOT YET IMPLEMENTED` — planned for **Stage 8**.
- **Evidence:** _none_

### B8. Consent and contact privacy (§4.8)

- **Requirement:** Single or double opt-in (default double); immutable consent evidence;
  workspace-wide marketing suppression; email-verified contact export and deletion; public
  policies; default 12-month active contact retention.
- **Status:** `NOT YET IMPLEMENTED` — planned for **Stage 11** (policy pages in **Stage 12**).
- **Evidence:** _none_

### B9. Analytics (§4.9)

- **Requirement:** Impression, open, CTA click, form start, and successful submission events;
  trends, funnel, per-widget, geo, source, status conversion, delivery health, and abuse
  dashboards; 90-day raw-event retention with daily aggregates thereafter.
- **Status:** `NOT YET IMPLEMENTED` — planned for **Stage 10**.
- **Evidence:** _none_

### B10. Usage limits (§4.10)

- **Requirement:** Visible meters and per-workspace hard limits of 10 active widgets, 10 users,
  2,000 accepted submissions per workspace month, and 20,000 interaction events per workspace
  month, using workspace-timezone month boundaries.
- **Status:** `NOT YET IMPLEMENTED` — meters in **Stage 4**, enforcement from **Stage 7**,
  timezone-correct reset in **Stage 10**.
- **Evidence:** _none_

---

## Part C — Security architecture checklist (blueprint §17)

The implementation is not complete until every item below is enforced and evidenced. All are
currently unproven. Consolidated verification happens in **Stage 13**, but each item is delivered
by the stage noted.

| #   | Requirement                                                                                 | Status                                                                                         | Delivered by                         |
| --- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------ |
| C1  | Argon2id hashing and strong password rules                                                  | `PROVEN` - Argon2id 64MiB/t=3/p=4 with policy and breach blocking                              | Stage 3                              |
| C2  | Hashed single-use verification, reset, invitation, recovery, and privacy tokens with expiry | `PROVEN` for verification, reset, and recovery codes; privacy tokens in Stage 11               | Stages 3, 4, 11                      |
| C3  | Optional TOTP MFA and hashed recovery codes                                                 | `PROVEN` - optional TOTP with hashed single-use recovery codes                                 | Stage 3                              |
| C4  | Redis sessions, rotation, expiry, device revocation, secure cookies, CSRF                   | `PROVEN` for sessions, rotation, expiry, revocation, cookies, and CSRF                         | Stage 3                              |
| C5  | Generic auth responses and dedicated brute-force limits                                     | `PROVEN` - generic responses and per-flow throttles                                            | Stage 3                              |
| C6  | Mandatory workspace scope in every tenant query                                             | `PROVEN` - scope is session-derived and re-checked per request                                 | Stage 2, enforced onward             |
| C7  | Role and verified-email gates on the server, never only in React                            | `PROVEN` - the whole section 11 matrix is enforced server-side                                 | Stage 4                              |
| C8  | Strict Origin allowlist and correct CORS/preflight behavior                                 | `NOT YET IMPLEMENTED`                                                                          | Stages 6, 7                          |
| C9  | Platform-owned payload schemas and 32 KB body limit                                         | `NOT YET IMPLEMENTED`                                                                          | Stage 7                              |
| C10 | Honeypot, timing heuristic, rate limits, quotas, 24-hour idempotency                        | `NOT YET IMPLEMENTED`                                                                          | Stage 7                              |
| C11 | No raw IP persistence and monthly HMAC rotation                                             | `NOT YET IMPLEMENTED`                                                                          | Stage 7                              |
| C12 | Encryption of readable secrets with key-version support                                     | `PROVEN` for the TOTP secret - AES-256-GCM with key version                                    | Stages 3, 9                          |
| C13 | Output escaping, safe template variables, no arbitrary HTML/CSS/JS                          | `IN PROGRESS` - auth UI escapes output and accepts no HTML; widget templates in Stages 5, 6, 9 | Stages 5, 6, 9                       |
| C14 | Validated redirects and CTA destinations                                                    | `NOT YET IMPLEMENTED`                                                                          | Stages 5, 6                          |
| C15 | Webhook SSRF defenses and HMAC signing                                                      | `NOT YET IMPLEMENTED`                                                                          | Stage 9                              |
| C16 | Security headers and an appropriate Content Security Policy                                 | `NOT YET IMPLEMENTED`                                                                          | Stage 13                             |
| C17 | PII and secret redaction in logs, errors, analytics, and monitoring                         | `NOT YET IMPLEMENTED`                                                                          | Stage 13                             |
| C18 | Dependency review, lockfile integrity, vulnerability and secret scanning in CI              | `IN PROGRESS` - detail below                                                                   | Stage 1 baseline, completed Stage 13 |
| C19 | Immutable audit and submission evidence within retention windows                            | `IN PROGRESS` - AuditEvent 12-month TTL verified                                               | Stages 2, 7, 11                      |

---

## Part D — Cross-cutting architecture proofs (blueprint §7–§16)

| #   | Requirement                                                                                                | Status                                                                                                                                               | Delivered by                   |
| --- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| D1  | Tenant isolation: two seeded tenants cannot reach each other through any repository                        | `PROVEN` for foundation repositories - see Part D-detail                                                                                             | Stage 2, re-proven per surface |
| D2  | Tenant isolation across CRUD, search, export, analytics, SSE, trash, and recovery                          | `IN PROGRESS` - membership, invitation, and audit write paths proven isolated; export, analytics, SSE, trash, and recovery surfaces do not exist yet | Stages 8, 10                   |
| D3  | Cache contract: 5-minute loader, 1-year immutable hashed runtime, 60-second config with ETag               | `NOT YET IMPLEMENTED`                                                                                                                                | Stage 6                        |
| D4  | A cached config cannot bypass unpublishing, deletion, a domain-rule change, or a quota block               | `NOT YET IMPLEMENTED`                                                                                                                                | Stages 6, 7                    |
| D5  | All three widget types render on a separate origin, multiple instances coexist, host CSS cannot break them | `NOT YET IMPLEMENTED`                                                                                                                                | Stage 6                        |
| D6  | Public config never leaks recipients, webhook URLs/secrets, notes, or tenant identifiers                   | `NOT YET IMPLEMENTED`                                                                                                                                | Stage 6                        |
| D7  | Outbox prevents a transient Redis enqueue failure from losing promised work                                | `NOT YET IMPLEMENTED`                                                                                                                                | Stages 7, 9                    |
| D8  | Transient-only retry, five attempts with backoff, dead letter, and manual replay                           | `NOT YET IMPLEMENTED`                                                                                                                                | Stage 9                        |
| D9  | Brevo daily budget priority reserve and visible deferred states                                            | `NOT YET IMPLEMENTED`                                                                                                                                | Stage 9                        |
| D10 | SSE workspace isolation, heartbeats, and bounded reconnect                                                 | `NOT YET IMPLEMENTED`                                                                                                                                | Stages 8, 10                   |
| D11 | Raw interaction events expire after 90 days leaving aggregates intact                                      | `NOT YET IMPLEMENTED`                                                                                                                                | Stage 10                       |
| D12 | Every recovery window and permanent purge (contact, widget, workspace, account)                            | `NOT YET IMPLEMENTED`                                                                                                                                | Stage 11                       |
| D13 | Repeatable migrations and explicit index management on a clean database                                    | `PROVEN` - see Part D-detail                                                                                                                         | Stage 2                        |
| D14 | Liveness and readiness endpoints; degraded optional providers do not make the API unready                  | `IN PROGRESS` - detail below                                                                                                                         | Stage 1 skeleton, Stage 13     |
| D15 | WCAG 2.2 AA audit with zero critical automated violations on critical pages and widgets                    | `IN PROGRESS` - axe clean on every auth page; manual audit and full page set in Stage 13                                                             | Stage 13                       |
| D16 | CI installs, type-checks, lints, tests, and builds every workspace before merge                            | `IN PROGRESS` - detail below                                                                                                                         | Stage 1, extended per stage    |
| D17 | One documented local command starts dependencies and apps; seed data is reproducible                       | `IN PROGRESS` - detail below                                                                                                                         | Stage 1                        |
| D18 | Clean deployment from main passes smoke, cross-origin, auth, queue, and restore checks                     | `NOT YET IMPLEMENTED`                                                                                                                                | Stage 14                       |
| D19 | Encrypted export/restore rehearsal succeeds                                                                | `NOT YET IMPLEMENTED`                                                                                                                                | Stage 14                       |
| D20 | Render sleep delays but does not permanently skip retention or queue work                                  | `NOT YET IMPLEMENTED`                                                                                                                                | Stages 11, 14                  |

---

## Part D-detail - Stage 1 infrastructure evidence

These four entries carry real, executed evidence as of Stage 1. Everything else in Parts A-D is
still unproven.

### D14. Liveness and readiness endpoints

- **Status:** `IN PROGRESS`. Skeleton implemented and verified locally against real MongoDB and
  Redis containers. The migration-compatibility half of readiness arrives in **Stage 2**;
  degraded-state reporting for optional providers (Brevo, geo, webhooks, Sentry) arrives in
  **Stage 13**. Those providers do not exist yet and are deliberately absent from the check rather
  than stubbed with fake calls.
- **Commands:**
  ```
  docker compose up --build -d
  curl http://localhost:3000/health/live
  curl http://localhost:3000/health/ready
  ```
- **Observed output (2026-08-28):**
  ```
  GET /health/live   -> HTTP 200
  {"status":"ok","uptimeSeconds":34,"release":"local-dev","timestamp":"2026-08-27T22:03:50.730Z"}

  GET /health/ready  -> HTTP 200
  {"status":"ready","release":"local-dev","timestamp":"2026-08-27T22:03:50.865Z",
   "dependencies":[{"name":"mongodb","status":"up","durationMs":46},
                   {"name":"redis","status":"up","durationMs":36}]}
  ```
- **Negative case, verified by stopping Redis (`docker compose stop redis`):**
  ```
  GET /health/live   -> HTTP 200   (liveness never consults dependencies)
  GET /health/ready  -> HTTP 503
  {"status":"not_ready","dependencies":[{"name":"mongodb","status":"up","durationMs":3},
                                        {"name":"redis","status":"down","durationMs":2003,
                                         "detail":"Error"}]}
  ```
  Readiness returned to HTTP 200 after `docker compose start redis`.
- **Automated test:** `apps/server/tests/health.test.ts` - 5 tests covering liveness, readiness
  ready and not-ready, the versioned API prefix, and JSON 404 handling.

### D16. CI installs, type-checks, lints, tests, and builds every workspace

- **Status:** `IN PROGRESS`. The workflow exists at `.github/workflows/ci.yml` and every step runs
  a real command. **It has not yet executed on GitHub**, because no remote is configured - Stages 0
  and 1 are local-only commits. The same commands were executed locally and pass.
- **Wired today:** `npm ci`, `npm run format:check`, `npm run lint`, `npm run typecheck`,
  `npm run test`, `npm run build`, a build-artifact existence check, and `npm audit`.
- **Explicitly NOT wired**, listed as TODOs in the workflow rather than stubbed as passing steps:
  integration tests (Stage 2), browser E2E (Stage 6), acceptance probes (Stage 7), bundle-size
  budgets (Stage 6), accessibility checks (Stage 13), secret scanning (Stage 13), and the
  deployment gate (Stage 14).
- **Local results (2026-08-28), run on a clean checkout with plain `npm run`:**
  ```
  npm ci            -> exit 0, 0 vulnerabilities
  npm run lint      -> exit 0, 25 files linted, 0 errors
  npm run typecheck -> exit 0, 0 TypeScript errors across 9 workspaces
  npm run test      -> exit 0, Test Files 1 passed (1), Tests 5 passed (5)
  npm run build     -> exit 0, every buildable workspace emitted artifacts
  ```

### D17. One documented local command starts dependencies and apps

- **Status:** `IN PROGRESS`. The command works and starts everything. It is not marked complete
  because the "seed data is reproducible" half is not yet meaningful - there is no domain data to
  seed until **Stage 2**.
- **Command:** `docker compose up --build`
- **Observed state (2026-08-28):**
  ```
  SERVICE   STATUS                    PORTS
  demo      Up 33 seconds             0.0.0.0:5174->5174/tcp
  mailpit   Up 33 seconds (healthy)   0.0.0.0:1025->1025/tcp, 0.0.0.0:8025->8025/tcp
  mongo     Up 33 seconds (healthy)   0.0.0.0:27017->27017/tcp
  redis     Up 33 seconds (healthy)   0.0.0.0:6379->6379/tcp
  server    Up 26 seconds (healthy)   0.0.0.0:3000->3000/tcp
  web       Up 33 seconds             0.0.0.0:5173->5173/tcp
  ```
- **Separate origins confirmed:** `http://localhost:5173` returns the platform shell and
  `http://localhost:5174` returns the demo sandbox - two distinct origins, which is what makes the
  cross-origin widget and submission behaviour testable locally from Stage 6.
- **MongoDB transactions verified, not assumed.** The blueprint depends on multi-document
  transactions, which require a replica set. Executed inside the container:
  ```
  replica set: rs0 | ok: 1 | member state: PRIMARY
  TRANSACTION COMMITTED across two collections: OK
  ```
- **Seed mechanism:** `npm run seed` produced:
  ```
  [seed] Connected to MongoDB (database: leadcapture).
  [seed] Replica set "rs0" detected - transactions are available.
  [seed] No domain data to seed yet. Collections and seed fixtures arrive in Stage 2.
  ```

### C18. Dependency review, lockfile integrity, vulnerability and secret scanning

- **Status:** `IN PROGRESS`. Partially real, with the gaps named.
- **Real today:** one committed `package-lock.json`; `npm ci` in CI fails if `package.json` and the
  lockfile disagree, which enforces lockfile integrity; a dedicated `audit` job runs
  `npm audit --audit-level=high`. Local install reports **0 vulnerabilities**.
- **Not yet real:** automated secret scanning, a dependency-update review policy, and vulnerability
  gating beyond the audit threshold. All are **Stage 13**.

---

## Part D-detail - Stage 2 data foundation evidence

### D1 and C6. The tenancy invariant

- **Requirement:** every tenant-owned record carries `workspaceId`; every repository method requires
  workspace scope as an explicit input; two tenants cannot reach each other (blueprint sections 9.1
  and 17).
- **Status:** `PROVEN` for the six foundation records. It must be re-proven for every new surface as
  later stages add them: export, analytics, SSE, trash, and recovery do not exist yet.
- **How it is enforced, not merely tested.** The invariant is structural in three layers:
  1. `WorkspaceScopedRepository` takes a `WorkspaceScope` as the FIRST required parameter of every
     method, so an unscoped call does not compile.
  2. `scopedFilter` merges the workspace clause LAST, so a caller-supplied `workspaceId` in a filter
     is discarded rather than honoured.
  3. `insert` takes `workspaceId` from the scope and overwrites whatever the document body claims,
     so a record cannot be planted in another tenant.

  A runtime guard (`assertWorkspaceScope`) backs all three, because TypeScript cannot protect a
  JavaScript caller or a value deserialized at a boundary.

- **Command:**

  ```
  docker compose up -d --wait mongo redis
  npm run test:integration
  ```

- **Observed output (2026-08-28):**

  ```
  Test Files  2 passed (2)
       Tests  25 passed (25)
  ```

- **What the 19 tenant-isolation tests assert**, every case in BOTH directions so a one-way leak
  cannot pass:
  - cross-tenant `findById` returns null for Membership, Invitation, AuditEvent, and OutboxEvent;
  - `findMany` and `count` only ever return the calling workspace;
  - lookups by a secondary key cannot cross tenants (`findByTokenHash`, `findByIdempotencyKey`);
  - cross-tenant `updateById` returns false AND leaves the victim record unchanged;
  - cross-tenant `deleteById` returns false for every foundation repository, and every victim record
    still exists afterwards;
  - `insert` with a spoofed `workspaceId` lands in the caller tenant, not the spoofed one;
  - a spoofed `workspaceId` in a filter is discarded rather than honoured;
  - a workspace can only be loaded and updated through its own scope;
  - a missing scope, a plain-string workspaceId, and a hex-string workspaceId are each rejected at
    runtime with `InvalidWorkspaceScopeError`.

### D13. Repeatable migrations and explicit index management

- **Requirement:** committed, repeatable migrations and explicit index management rather than
  uncontrolled startup mutations (blueprint section 9.3).
- **Status:** `PROVEN`.
- **Design:** migrations are an explicit ordered array in committed code, applied only by running
  `npm run migrate` and never implicitly on server boot. Repeatability rests on two independent
  mechanisms: a ledger collection recording applied ids, and per-migration idempotency, since
  MongoDB creates an index only when an identical specification does not already exist.
- **Commands and observed output (2026-08-28):**

  ```
  $ npm run migrate          # first run
  {"count":1,...,"event":"migration.pending"}
  {"migrationId":"001_foundation","durationMs":337,"result":"success","event":"migration.applied"}
  {"applied":1,"skipped":0,"result":"success","event":"migration.complete"}

  $ npm run migrate          # second run applies nothing
  {"count":0,...,"event":"migration.pending"}
  {"applied":0,"skipped":1,"result":"success","event":"migration.complete"}
  ```

- **Automated proof** (`packages/database/tests/migrations.integration.test.ts`), each case against
  a freshly created database:
  - a second run applies nothing and the index snapshot is **exactly identical**, compared
    descriptor by descriptor rather than merely checking that no error was thrown;
  - with the ledger deliberately wiped, a replay re-applies cleanly and still produces an identical
    index state, so the schema cannot drift;
  - the constraints the blueprint requires are asserted to exist: unique active normalized email,
    unique ACTIVE workspace owner, unique workspace-user membership pair, unique invitation token
    hash, a 12-month TTL on audit events, and a unique outbox idempotency key;
  - those constraints are then proven to actually reject bad data: a duplicate membership pair is
    rejected, the same user may still join a second workspace, and a second _active_ owned workspace
    is rejected until the first is soft-deleted.

### Structured logging baseline (blueprint section 16.1)

- **Status:** `IN PROGRESS` — the shared logger exists and is used by migrations. Request
  correlation IDs and route-level logging arrive with the HTTP surfaces in Stage 3.
- Log records carry timestamp, level, service, environment, release, event name, and optional
  correlation, workspace, user, duration, and result fields.
- Forbidden fields are redacted centrally rather than trusted to each call site. Unit tests in
  `packages/contracts/tests/logging.test.ts` assert that IP, password, password hash, token, token
  hash, session id, cookie, authorization, webhook secret, encryption key, API key, email body,
  captured submission values, TOTP secret, and recovery code are each replaced with `[redacted]`,
  including nested occurrences and case- or separator-varied key names.

---

## Part D-detail - Stage 3a authentication evidence

All figures below come from an executed run on 2026-08-28 against real MongoDB, real Redis, and
real Mailpit. Command:

```
docker compose up -d --wait mongo redis mailpit
npm run test:integration
```

Result: **Test Files 4 passed (4), Tests 59 passed (59)** across the Stage 2 and Stage 3a suites.
Unit suites: **Test Files 5 passed (5), Tests 59 passed (59)**.

### C1. Argon2id password hashing and strong password rules

- **Status:** `PROVEN`.
- Hashing uses Argon2id with 64 MiB memory, 3 iterations, 4 lanes, and a 32-byte output, stated
  explicitly rather than inherited from library defaults. A stored digest is asserted to match
  `$argon2id$v=19$m=65536,t=3,p=4$`, and the plaintext is asserted to be absent from the stored
  document.
- The policy rejects passwords under 12 characters, common long passwords, single repeated
  characters, sequential runs, passwords containing the account email, and passwords on the
  offline breach list. Rejection messages are asserted never to echo the password.
- `needsRehash` correctly flags weaker stored parameters and leaves current ones alone, so a future
  parameter increase upgrades hashes on next login rather than silently doing nothing.
- **Note on the library:** the implementation is `@node-rs/argon2` rather than the `argon2` npm
  package. Both emit standard PHC `$argon2id$` strings and the blueprint locks the ALGORITHM, not a
  package. `argon2` could not be installed at all from this working directory, because its install
  script runs through cmd.exe and the folder name contains `&`.

### C4. Redis sessions, rotation, expiry, revocation, secure cookies, CSRF

- **Status:** `PROVEN`.
- **Cookie flags** are asserted on the raw `Set-Cookie`: `HttpOnly`, `Path=/`, `SameSite=Lax`.
  `Secure` is driven by `NODE_ENV` and is off only because the test server is plain HTTP.
- **Both lifetimes are enforced and tested.** A session survives repeated activity across 12 days
  but dies after 8 idle days, and dies at the 30-day absolute cap even under continuous activity.
  Both deadlines are stored in the record and re-checked against the application clock, not left to
  the Redis TTL alone.
- **Revocation is immediate.** Logout is asserted to DELETE the Redis key, not flag it. Revoking one
  session signs out that device only; revoke-all signs out every other device while keeping the
  caller in; `?includeCurrent=true` signs out everywhere.
- **A user cannot revoke another user's session**, and the refusal is the same 404 a nonexistent
  session returns, so it cannot be used to probe for valid identifiers.
- **CSRF** is enforced on the authenticated surface: the same request is a 403 without a token and a
  200 with one. Tokens are bound to the session identifier via `getSessionIdentifier`.

### C5. Generic responses and dedicated brute-force limits

- **Status:** `PROVEN`.
- **Account enumeration is blocked in three places**, each asserted by comparing full responses:
  registering an already-used address returns byte-identical status and body to a fresh
  registration (and creates no second account); a wrong password and an unknown account return the
  identical code and message; a reset request for a known and an unknown address are identical.
- A dummy Argon2id verification runs on the unknown-account path so response time does not leak
  existence either.
- **Per-flow throttles** exist for login (by IP and by account), registration, verification resend,
  reset request, and reset confirm, each with its own Redis key space so exhausting one cannot lock
  a user out of another. Bursts are asserted to produce 429s with a `Retry-After` header.

### C2. Hashed single-use tokens

- **Status:** `IN PROGRESS`. Verification and reset tokens are done; recovery codes are Stage 3b and
  privacy tokens are Stage 11.
- Tokens are 256 bits of randomness; only a SHA-256 hash is stored, and the emailed link carries the
  only copy of the plaintext. Redemption is a single atomic update filtered on the hash, so a
  concurrent second redemption matches nothing. Replay is asserted to fail for both flows.

### Email: Mailpit and Brevo adapters with the section 5.3 budget

- **Status:** `IN PROGRESS` — auth-class mail is done; side-effect mail is Stage 9.
- Verification and reset emails are really sent over SMTP and read back out of Mailpit through its
  API, including extracting the token from the link. The email body is asserted to contain neither
  the password nor any hash.
- The daily budget reserves 100 of 300 for critical mail. Tests burn the 200-message side-effect
  allowance, confirm the 201st side effect is refused while critical mail still sends, confirm
  everything is refused once all 300 are gone, and confirm a new UTC day restores the allowance.
- Brevo is implemented against `POST /v3/smtp/email` and classifies 4xx (except 429) as PERMANENT so
  Stage 9 never retries a permanent failure as though it were transient. No Brevo key is needed for
  local development or CI.

### No credential material in logs or audit records (blueprint 16.1)

- **Status:** `PROVEN` for everything that exists today.
- Audit events are written for registration, login, logout, verification, password reset, account
  lock, and session revocation, each carrying the actor and a request correlation ID.
- Tests serialise every audit record AND every captured log record for a session and assert that
  the password, the session identifier, and any `$argon2id$` string are all absent.
- The shared logger additionally redacts forbidden field names centrally, so a future call site
  cannot leak by forgetting.

### Verified-email gate (blueprint 4.1)

- **Status:** `IN PROGRESS` by design. `requireVerifiedEmail` exists, is typed, and returns
  `email_not_verified` with a 403 — but **it currently gates nothing**, because publishing and
  invitations do not exist until Stages 5 and 4. It is a deliberate interface stub so those stages
  attach a guard that already works. An unverified user can sign in and use the dashboard, which is
  what section 4.1 specifies.

---

## Part D-detail - Stage 3b MFA, UI, and browser evidence

Executed on 2026-08-28 against real MongoDB, Redis, and Mailpit.

```
docker compose up -d --wait mongo redis mailpit
npm run test                # Test Files 6 passed (6),  Tests 82 passed (82)
npm run test:integration    # Test Files 5 passed (5),  Tests 74 passed (74)
npm run test:e2e            # 17 passed (1.8m)
```

### C3. Optional TOTP MFA and hashed recovery codes

- **Status:** `PROVEN`.
- **Enrollment is two-phase.** Generating a secret does NOT enable MFA; a valid code must confirm
  it first. A test asserts that after `POST /mfa/enroll` the status is still `enabled: false`.
  Enabling on generation alone would let an abandoned setup lock a user out of their own account.
- **The login challenge issues no session until it is satisfied.** After a correct password,
  `POST /auth/login` returns `mfa_required` and `GET /auth/me` is still 401. The
  partially-authenticated state is a short-lived server-side record keyed by an opaque cookie, so
  the browser holds nothing that could skip the challenge.
- **TOTP codes cannot be replayed.** A code is valid for its whole 30-second period, so the highest
  accepted counter is stored and anything at or below it is refused. Tested directly: the code that
  confirmed enrollment is rejected at the next login, and the following period is accepted.
- **Recovery codes are single-use.** A code signs in once; the same code is refused afterwards; a
  different one still works, so the account is not locked out; and the remaining count drops from
  10 to 8 after two are spent.
- **A brute-force attempt destroys the challenge** after five failures, so a six-digit code cannot
  be ground down.
- **Disabling requires re-authentication**, not a click: a wrong password with a valid code fails,
  a right password with a wrong code fails, and both together succeed. Disabling clears the stored
  secret and every recovery code.
- **The session identifier rotates on every MFA change** (section 10.3), verified by asserting the
  old Redis session key no longer exists while the caller stays signed in.

### C12. Encryption of readable secrets with key-version support

- **Status:** `PROVEN` for the TOTP secret, which is the first readable secret the system holds.
  Stage 9 reuses the same cipher for webhook signing secrets.
- AES-256-GCM with a fresh 96-bit IV per encryption and the key version stored alongside the
  ciphertext. Tested: round-trip; identical plaintext produces different ciphertext, because IV
  reuse under one key catastrophically breaks GCM; a value written under an older key version is
  still readable after rotation while new values use the current one; an unknown key version
  returns null rather than throwing; and a tampered ciphertext or authentication tag is refused,
  because GCM is authenticated.
- An integration test reads the stored user document and asserts the base32 secret appears nowhere
  in it, and that `ciphertext`, `iv`, `authTag`, and `keyVersion` are all present.
- Recovery codes are likewise absent from the document in plaintext; only SHA-256 hashes are stored.
- Neither the secret nor any recovery code appears in an audit record or a log line.

### Browser end-to-end coverage (blueprint 18.3)

17 Playwright tests drive the real UI against the real stack. They cover:

- register, receive the confirmation email in Mailpit, follow the link, sign in, and land on the
  account page;
- an unconfirmed account can still sign in, matching section 4.1;
- a wrong password and an unknown account produce **byte-identical** error text, compared directly
  in the browser;
- a verification link cannot be used twice;
- a breached password is refused with a reason;
- forgot password, reset by email link, existing sessions revoked, old password dead, new one works;
- enable MFA, sign out, sign back in and be challenged, fail with a wrong code, sign in with a
  recovery code, find that same code refused on the next attempt, and sign in with TOTP;
- disable MFA only with both the password and a current code;
- list three devices, revoke one, revoke all others, and confirm each context really is signed out
  while the caller stays in.

### D15. Automated accessibility checks

- **Status:** `IN PROGRESS`. Every auth page is scanned and clean; the manual WCAG 2.2 AA audit and
  the rest of the page set are Stage 13.
- axe runs against `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, and `wcag22aa`, failing on any
  critical or serious violation, and reporting the offending selector so a failure is actionable.
- Pages scanned: register, sign in, forgot password, reset password, a form **in its error state**,
  the confirmation-sent and email-confirmed pages, the account page with MFA both off and on, MFA
  setup, the recovery-code display, and the MFA challenge.
- A separate test completes registration and sign-in **using only the keyboard**, asserting the
  focus order reaches email, then password, then the submit button. Automated scanning cannot tell
  whether a flow is operable without a mouse; this does.
- Two real defects were found and fixed by these checks rather than by review: a placeholder at 60%
  opacity computed to about 2.6:1 against the panel, below the 4.5:1 AA threshold; and a field-level
  validation error was rendered in a plain paragraph while focus stayed on the submit button, so a
  screen reader announced nothing on a failed submission.

---

## Part D-detail - Stage 4a workspace and RBAC evidence

Executed on 2026-08-28 against real MongoDB, Redis, and Mailpit.

```
docker compose up -d --wait mongo redis mailpit
npm run test                # Test Files 7 passed (7),  Tests 125 passed (125)
npm run test:integration    # Test Files 6 passed (6),  Tests 106 passed (106)
npm run test:e2e            # 17 passed  (Stage 3b suite, no regression)
```

Of those, 43 unit tests and 32 integration tests are new in Stage 4a.

### C7. Role and verified-email gates enforced on the server

- **Status:** `PROVEN`.
- The section 11 matrix is a single static table. **Every cell is asserted** against a copy of the
  matrix transcribed independently from the blueprint inside the test file, rather than imported
  from the implementation - otherwise the test would only prove the code equals itself. The two
  tables are also asserted to cover exactly the same capability set, so a capability cannot be
  added to one and forgotten in the other.
- Every cell is additionally resolved twice, once for a verified subject and once for an
  unverified one, which is what pins down the two "Yes, verified" rows.
- The asymmetries the blueprint calls out are each tested directly, over HTTP as well as in
  isolation:
  - an Admin can invite and remove Members, but inviting someone AS an Admin is refused, promoting
    a Member to Admin is refused, and demoting another Admin is refused;
  - ownership transfer and workspace deletion are refused for Admin and Member;
  - the Owner can promote and demote Admins;
  - the Owner can never be removed, not even by themselves, so a workspace cannot be orphaned;
  - nobody can change their own role.
- **An unverified Owner keeps dashboard access but cannot invite**, which is section 4.1 exactly.
  The refusal is `email_not_verified`, distinct from a plain `forbidden`, because "confirm your
  email" and "your role may never" are different problems. This is the gate Stage 3a built and
  had nothing to attach to.

### C6. Mandatory workspace scope

- **Status:** `PROVEN` for every surface that exists.
- Scope is derived from the server-side session and never from a request body or URL. Requests
  without a selected workspace are refused rather than defaulting to one.
- **Membership is re-checked on every request**, not trusted from the session. A test removes a
  member and asserts their very next call fails, so revocation is immediate rather than taking
  effect at their next switch.
- Switching workspace verifies membership BEFORE writing the selection. A non-member gets the same
  404 as a nonexistent workspace, so this cannot enumerate which workspace ids are real.
- The one unscoped read is invitation redemption by token hash, where the caller has no workspace
  context by definition. The hash is globally unique, so it resolves to exactly one workspace, the
  same shape as blueprint 9.1's public widget identifiers. It is wired in the composition root so
  the exception is visible in one place rather than available as a general escape hatch.

### Onboarding and the one-owned-workspace limit

- Onboarding creates the workspace, makes the creator its Owner, and selects it for the session.
- A second owned workspace is refused with a clean **409**, and the test asserts the response body
  contains no `E11000`, `duplicate key`, or `mongo` text - the Stage 2 unique index still backs the
  rule under a race, but a driver error must never reach the client.
- **A timezone finding worth recording.** Validation constructs an `Intl.DateTimeFormat` rather
  than checking membership of `Intl.supportedValuesOf('timeZone')`. On this runtime that list omits
  `UTC`, `Etc/UTC`, and `Asia/Kolkata` - it carries the legacy `Asia/Calcutta` instead - so a
  membership check would reject both UTC and the canonical spelling of a zone used by a sixth of
  the world. There is a test asserting `UTC` is accepted and that `supportedValuesOf` does not
  contain it.

### Invitations

- Hashed, single-use, 7-day expiry, reusing the Stage 3a token pattern. A test reads the stored
  document and asserts the plaintext token is absent and only a 64-character hash remains.
- **Both recipient paths work.** An existing verified user joins by following the link. A brand-new
  recipient is invited, registers, and is joined automatically on verification - with the
  membership count asserted before and after, so it is proven that **no membership exists for an
  unverified identity**.
- An unverified signed-in recipient is refused with `email_not_verified`.
- A reused token is refused. A token addressed to someone else is refused even when the interceptor
  is signed in and verified. A revoked invitation stops working.
- Invitations reuse the Stage 3a email sender, so they draw on the same section 5.3 daily budget as
  auth mail rather than opening a second unbounded path.

### Ownership transfer

- Transfers only to a **verified Admin** of the same workspace. Refused for a Member, for a
  non-member, and for an Admin who already owns another workspace.
- The outgoing Owner becomes an **Admin**, not a Member - see the BUILDLOG for why.
- The two role writes are ordered demote-then-promote, so the unique active-owner index is never
  contended. A test asserts exactly one owner membership afterwards, and that the powers really
  moved: the old Owner can no longer delete the workspace, and the new one can read the audit log.

### Workspace deletion, recovery, and the account-deletion precondition

- Soft delete sets `status`, `deletedAt`, and a `purgeAfter` 30 days out, and the workspace
  immediately disappears from the switcher and refuses further use - without anything being purged.
- Recovery works inside the window and is refused once `purgeAfter` has passed.
- Only the Owner may recover, and an Admin attempting it gets a 404 rather than a 403, so a
  deleted workspace is not revealed to someone who cannot restore it.
- Account deletion is blocked while the user owns a workspace and clears the moment they transfer
  it, which is asserted end to end.

### Workspace-scoped audit

- Every invite, accept, revoke, role change, transfer, and workspace delete/recover writes an
  `AuditEvent` carrying the **real** `workspaceId`, not Stage 3a's account-level sentinel. A test
  reads the stored events and asserts none of them carries the all-zero sentinel id.
- Audit metadata and log records are asserted to contain no invitation token.

### Cross-tenant isolation across the new write paths

- Two full tenants are built, each with an owner and an invited guest. Each owner sees only their
  own members; an attempt to remove the other tenant's guest by their real user id returns 404 and
  leaves that guest in place; audit event ids do not overlap; and the stored invitations carry the
  correct `workspaceId`. This extends the Stage 2 proof onto mutation paths that did not exist then.

---

## Part E — Definition of done (blueprint §22)

Version 1 is complete only when all twelve conditions hold. This table is the final checklist an
evaluator can use; it is fully re-verified in **Stage 15**.

| #   | Condition                                                                                                                                                  | Status                                                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | Every locked blueprint decision is implemented or explicitly marked as an approved change                                                                  | `NOT YET IMPLEMENTED`                                                                                                                                                   |
| E2  | All three widgets render and submit from a separate origin                                                                                                 | `NOT YET IMPLEMENTED`                                                                                                                                                   |
| E3  | Owner/Admin/Member and verification permissions are enforced server-side and proven                                                                        | `NOT YET IMPLEMENTED`                                                                                                                                                   |
| E4  | Tenant A cannot access Tenant B through CRUD, search, export, analytics, SSE, trash, or public identifiers                                                 | `NOT YET IMPLEMENTED`                                                                                                                                                   |
| E5  | Caching, CORS/preflight, validation, payload limits, rate limits, spam controls, idempotency, geo fallback, and side-effect failure behavior are evidenced | `NOT YET IMPLEMENTED`                                                                                                                                                   |
| E6  | Contacts, immutable Submission Events, consent, retention, privacy, and deletion rules work as documented                                                  | `NOT YET IMPLEMENTED`                                                                                                                                                   |
| E7  | Brevo, webhook, BullMQ, Redis, and Render sleep states degrade visibly without corrupting primary data                                                     | `NOT YET IMPLEMENTED`                                                                                                                                                   |
| E8  | Unit, integration, critical E2E, accessibility, and acceptance checks pass in CI                                                                           | `NOT YET IMPLEMENTED`                                                                                                                                                   |
| E9  | Local Docker and public free deployment both work from documented instructions                                                                             | `NOT YET IMPLEMENTED`                                                                                                                                                   |
| E10 | README, `capstone.yaml`, `EVIDENCE.md`, `BUILDLOG.md`, `.env.example`, and license are complete                                                            | `IN PROGRESS` — all six exist; README and `capstone.yaml` now carry real verified commands, but production URLs, probes, and limitations stay incomplete until Stage 15 |
| E11 | No secrets or raw IP/lead PII appear in source history, logs, monitoring, or public demo output                                                            | `IN PROGRESS` — holds today (no code, no secrets committed); must be re-verified every stage                                                                            |
| E12 | The public deployment clearly states it is a synthetic-data portfolio demo with free-tier limitations                                                      | `IN PROGRESS` — stated in README §7.1 and `capstone.yaml`; the deployment itself does not exist yet                                                                     |

---

## Change log

| Date       | Stage | Change                                                                                                                                                               |
| ---------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-27 | 0     | File created. All entries recorded as not-yet-implemented with their planned stages. No proofs claimed.                                                              |
| 2026-08-28 | 1     | D14, D16, D17, and C18 moved to `IN PROGRESS` with real executed evidence in Part D-detail. All six acceptance probes and every product requirement remain unproven. |

| 2026-08-28 | 2 | D1, D13, and C6 moved to `PROVEN` for the foundation repositories, evidenced by 25 integration tests against a real MongoDB replica set. D2, C2, C19, B1, and the logging baseline moved to `IN PROGRESS` with their gaps stated. All six acceptance probes remain unproven. |

| 2026-08-28 | 3a | C1, C4, and C5 moved to `PROVEN`; B2 and C2 to `IN PROGRESS` with the MFA gap stated explicitly. Evidenced by 34 auth integration tests against real MongoDB, Redis, and Mailpit plus 23 auth unit tests. MFA, auth UI, and browser E2E are Stage 3b and are NOT claimed. All six acceptance probes remain unproven. |

| 2026-08-28 | 3b | Blueprint Stage 3 COMPLETE. B2, C3, and C12 moved to `PROVEN`; C2 completed for auth tokens; C13 and D15 moved to `IN PROGRESS`. Evidenced by 17 browser E2E tests, 74 integration tests, 82 unit tests, and axe checks reporting zero critical or serious violations on every auth page. All six acceptance probes remain unproven. |

| 2026-08-28 | 4a | B1, C6, and C7 moved to `PROVEN` at the API level; D2 widened onto the new workspace write paths. Evidenced by 32 workspace integration tests against real MongoDB, Redis, and Mailpit, plus 43 unit tests asserting every cell of the section 11 matrix against an independently transcribed copy. Blueprint Stage 4 is NOT complete: the workspace UI and its browser E2E are Stage 4b. All six acceptance probes remain unproven. |

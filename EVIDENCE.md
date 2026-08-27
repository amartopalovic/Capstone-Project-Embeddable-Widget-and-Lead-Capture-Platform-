# EVIDENCE

One repeatable proof per requirement.

> ## Status at Stage 2: **no acceptance probe is proven.**
>
> Stage 2 delivered the data and contract foundation. The tenancy invariant (D1, C6) and
> repeatable migrations (D13) now carry real executed evidence, alongside the Stage 1
> infrastructure entries (D14, D16, D17, C18). **All six acceptance probes and every
> user-facing product requirement remain `NOT YET IMPLEMENTED`**, because no feature code
> exists yet.
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
- **Status:** `IN PROGRESS` — **data shape only**, delivered in Stage 2. The behaviour is
  **Stage 4** (accounts themselves in **Stage 3**).
- **What is real today:** `Workspace`, `Membership`, and `Invitation` records exist with the
  Owner/Admin/Member role type, a 7-day invitation expiry field, and soft-deletion fields. Two
  storage constraints are enforced and tested: a unique workspace-user membership pair, and a
  partial unique index allowing a user to own only ONE _active_ workspace while still joining many
  others.
- **What is NOT real:** registration, verification gates, role enforcement, invitation issuing or
  acceptance, and ownership transfer. Nothing checks a permission yet.
- **Evidence:** the constraint tests described in Part D-detail (D13).

### B2. Authentication and account security (§4.2)

- **Requirement:** Email/password with Argon2id; 12-character minimum with breached-password
  blocking; verification and reset flows; optional TOTP MFA; Redis server sessions with 7-day idle
  and 30-day absolute lifetime; device list and revocation; security audit events.
- **Status:** `NOT YET IMPLEMENTED` — planned for **Stage 3**.
- **Note:** the Stage 2 `User` record deliberately carries **no credential material at all** — no
  password hash, TOTP seed, or recovery codes. It models identity and verification state only
  (`normalizedEmail` with a unique partial index, `emailVerifiedAt`, and the deletion lifecycle).
  Stage 3 adds credential fields through its own migration.
- **Evidence:** _none for the requirement itself._

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

| #   | Requirement                                                                                 | Status                                                   | Delivered by                         |
| --- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------ |
| C1  | Argon2id hashing and strong password rules                                                  | `NOT YET IMPLEMENTED`                                    | Stage 3                              |
| C2  | Hashed single-use verification, reset, invitation, recovery, and privacy tokens with expiry | `IN PROGRESS` - hashed storage shape only                | Stages 3, 4, 11                      |
| C3  | Optional TOTP MFA and hashed recovery codes                                                 | `NOT YET IMPLEMENTED`                                    | Stage 3                              |
| C4  | Redis sessions, rotation, expiry, device revocation, secure cookies, CSRF                   | `NOT YET IMPLEMENTED`                                    | Stage 3                              |
| C5  | Generic auth responses and dedicated brute-force limits                                     | `NOT YET IMPLEMENTED`                                    | Stage 3                              |
| C6  | Mandatory workspace scope in every tenant query                                             | `PROVEN` for foundation repositories - see Part D-detail | Stage 2, enforced onward             |
| C7  | Role and verified-email gates on the server, never only in React                            | `NOT YET IMPLEMENTED`                                    | Stage 4                              |
| C8  | Strict Origin allowlist and correct CORS/preflight behavior                                 | `NOT YET IMPLEMENTED`                                    | Stages 6, 7                          |
| C9  | Platform-owned payload schemas and 32 KB body limit                                         | `NOT YET IMPLEMENTED`                                    | Stage 7                              |
| C10 | Honeypot, timing heuristic, rate limits, quotas, 24-hour idempotency                        | `NOT YET IMPLEMENTED`                                    | Stage 7                              |
| C11 | No raw IP persistence and monthly HMAC rotation                                             | `NOT YET IMPLEMENTED`                                    | Stage 7                              |
| C12 | Encryption of readable secrets with key-version support                                     | `NOT YET IMPLEMENTED`                                    | Stages 3, 9                          |
| C13 | Output escaping, safe template variables, no arbitrary HTML/CSS/JS                          | `NOT YET IMPLEMENTED`                                    | Stages 5, 6, 9                       |
| C14 | Validated redirects and CTA destinations                                                    | `NOT YET IMPLEMENTED`                                    | Stages 5, 6                          |
| C15 | Webhook SSRF defenses and HMAC signing                                                      | `NOT YET IMPLEMENTED`                                    | Stage 9                              |
| C16 | Security headers and an appropriate Content Security Policy                                 | `NOT YET IMPLEMENTED`                                    | Stage 13                             |
| C17 | PII and secret redaction in logs, errors, analytics, and monitoring                         | `NOT YET IMPLEMENTED`                                    | Stage 13                             |
| C18 | Dependency review, lockfile integrity, vulnerability and secret scanning in CI              | `IN PROGRESS` - detail below                             | Stage 1 baseline, completed Stage 13 |
| C19 | Immutable audit and submission evidence within retention windows                            | `IN PROGRESS` - AuditEvent 12-month TTL verified         | Stages 2, 7, 11                      |

---

## Part D — Cross-cutting architecture proofs (blueprint §7–§16)

| #   | Requirement                                                                                                | Status                                                                  | Delivered by                   |
| --- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------ |
| D1  | Tenant isolation: two seeded tenants cannot reach each other through any repository                        | `PROVEN` for foundation repositories - see Part D-detail                | Stage 2, re-proven per surface |
| D2  | Tenant isolation across CRUD, search, export, analytics, SSE, trash, and recovery                          | `IN PROGRESS` - repository CRUD proven; other surfaces do not exist yet | Stages 4, 8, 10                |
| D3  | Cache contract: 5-minute loader, 1-year immutable hashed runtime, 60-second config with ETag               | `NOT YET IMPLEMENTED`                                                   | Stage 6                        |
| D4  | A cached config cannot bypass unpublishing, deletion, a domain-rule change, or a quota block               | `NOT YET IMPLEMENTED`                                                   | Stages 6, 7                    |
| D5  | All three widget types render on a separate origin, multiple instances coexist, host CSS cannot break them | `NOT YET IMPLEMENTED`                                                   | Stage 6                        |
| D6  | Public config never leaks recipients, webhook URLs/secrets, notes, or tenant identifiers                   | `NOT YET IMPLEMENTED`                                                   | Stage 6                        |
| D7  | Outbox prevents a transient Redis enqueue failure from losing promised work                                | `NOT YET IMPLEMENTED`                                                   | Stages 7, 9                    |
| D8  | Transient-only retry, five attempts with backoff, dead letter, and manual replay                           | `NOT YET IMPLEMENTED`                                                   | Stage 9                        |
| D9  | Brevo daily budget priority reserve and visible deferred states                                            | `NOT YET IMPLEMENTED`                                                   | Stage 9                        |
| D10 | SSE workspace isolation, heartbeats, and bounded reconnect                                                 | `NOT YET IMPLEMENTED`                                                   | Stages 8, 10                   |
| D11 | Raw interaction events expire after 90 days leaving aggregates intact                                      | `NOT YET IMPLEMENTED`                                                   | Stage 10                       |
| D12 | Every recovery window and permanent purge (contact, widget, workspace, account)                            | `NOT YET IMPLEMENTED`                                                   | Stage 11                       |
| D13 | Repeatable migrations and explicit index management on a clean database                                    | `PROVEN` - see Part D-detail                                            | Stage 2                        |
| D14 | Liveness and readiness endpoints; degraded optional providers do not make the API unready                  | `IN PROGRESS` - detail below                                            | Stage 1 skeleton, Stage 13     |
| D15 | WCAG 2.2 AA audit with zero critical automated violations on critical pages and widgets                    | `NOT YET IMPLEMENTED`                                                   | Stage 13                       |
| D16 | CI installs, type-checks, lints, tests, and builds every workspace before merge                            | `IN PROGRESS` - detail below                                            | Stage 1, extended per stage    |
| D17 | One documented local command starts dependencies and apps; seed data is reproducible                       | `IN PROGRESS` - detail below                                            | Stage 1                        |
| D18 | Clean deployment from main passes smoke, cross-origin, auth, queue, and restore checks                     | `NOT YET IMPLEMENTED`                                                   | Stage 14                       |
| D19 | Encrypted export/restore rehearsal succeeds                                                                | `NOT YET IMPLEMENTED`                                                   | Stage 14                       |
| D20 | Render sleep delays but does not permanently skip retention or queue work                                  | `NOT YET IMPLEMENTED`                                                   | Stages 11, 14                  |

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

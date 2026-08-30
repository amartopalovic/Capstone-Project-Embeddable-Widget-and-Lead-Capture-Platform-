# EVIDENCE

One repeatable proof per requirement.

> ## Status at Stage 7: **all six acceptance probes pass locally.**
>
> Blueprint Stages 3 through 7 are complete. The hardened public submission path closes the six
> PDF acceptance probes in Part A below, each with its own named, re-runnable test.
>
> Two are proven only as far as this stage reaches, and both say so in place: A1's "visible
> dashboard result" needs the Stage 8 inbox, and A5's real queue, retry, and dead-letter behaviour
> needs Stage 9. What A5 proves now is the property that matters most — a failing side effect
> cannot reverse a stored lead — because the outbox record is written inside the submission's own
> transaction and nothing consumes it yet.
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
- **Status:** `PROVEN` at the API level in Stage 7. Dashboard visibility is **Stage 8**.
- **Command:** `npm run test:integration -- submission`
- **Evidence:** `PROBE 1: valid second-origin submission` in
  `apps/server/tests/submission.integration.test.ts`. A submission from `https://shop.example.com`
  to a widget served by the platform origin returns **202** with
  `access-control-allow-origin: https://shop.example.com`, and the assertions then read the
  database directly: a `Contact` with `status: new` and `submissionCount: 1`, an immutable
  `SubmissionEvent` carrying the values and `source.domain`, and an `OutboxEvent` with
  `status: pending` and idempotency key `submission:<eventId>` written in the same commit.
  A second test proves a repeat submission attaches to the SAME contact (two events, one contact,
  `submissionCount: 2`), and a third proves the stored event contains a 64-hex
  `ipPseudonym` and no raw address anywhere.
- **Not yet:** the "visible dashboard result" half. The contact inbox is Stage 8; what is proven
  here is that the record exists and is correct.

### A2. Malformed and oversized input

- **Requirement:** Malformed bodies, bodies over 32 KB, more than 20 fields, and long-text values
  above 5,000 characters all return clean 4xx JSON errors. Malformed or oversized input never
  becomes a 500 (blueprint §7.3, §10.1).
- **Status:** `PROVEN`.
- **Command:** `npm run test:integration -- submission`
- **Evidence:** `PROBE 2: malformed and oversized input` — five tests, one per rejection route: a
  40 KB body, a 6,000-character value, 25 fields, a field the published widget does not declare,
  and both a missing required field and a syntactically broken body. Each asserts the status is
  `>= 400 and < 500`, that the content type is JSON, and that a machine-readable error code is
  present. The undeclared-field case is the one worth noting: it proves the payload is checked
  against the SERVER-owned field schema (§7.3 step 4), so a crafted request cannot smuggle extra
  values into an event.

### A3. Burst traffic

- **Requirement:** Under burst load, 429 responses appear while a later legitimate request still
  succeeds. Limits: 5 submissions/minute per IP-widget pair, 30/hour per IP-widget pair, 100/minute
  per widget (blueprint §7.3).
- **Status:** `PROVEN`.
- **Command:** `npm run test:integration -- submission`
- **Evidence:** `PROBE 3: burst traffic`. Eight submissions from one client to one widget: at least
  five succeed with 202 and the burst then produces **429**, with the first 429 arriving after a
  successful request rather than at the start. The test then clears the window and shows a later
  legitimate submission returning **202** — the half of the probe that distinguishes a throttle
  from a ban. It also asserts an `AbuseEvent` of type `rate_limit` was recorded, which is the
  evidence §7.4 asks for.

### A4. Geo fallback

- **Requirement:** Provider A down → provider B enriches the submission. Both providers down → the
  submission is still stored successfully, without geo (blueprint §7.3, §18.4).
- **Status:** `PROVEN`, deterministically.
- **Command:** `npm run test:integration -- submission`
- **Evidence:** `PROBE 4: geo fallback` — three tests driving scripted providers through the
  `GeoProvider` port, so the outcomes are stated rather than waited for (§18.4). A answers →
  `provider: ip-api`, `usedFallback: false`. A down, B answers → `provider: ipapi-co`,
  `usedFallback: true`. Both down → the submission is **202** and the stored event has
  `geo: null`. A fourth test in PROBE 5 uses a provider that THROWS rather than returning null,
  and the lead still lands.
- **Note:** the real providers are never called by the suite. `GEO_ENABLED` defaults to false
  outside production, because ip-api's free endpoint allows 45 requests a minute per source
  address and excludes commercial use.

### A5. Side-effect failure

- **Requirement:** When email or webhook delivery throws, the primary submission remains successful
  and stored. Side effects can never reverse an accepted submission (blueprint §7.3, §12.2).
- **Status:** `PROVEN` for what Stage 7 owns. Real queue, retry, and dead-letter behaviour are
  **Stage 9**.
- **Command:** `npm run test:integration -- submission`
- **Evidence:** `PROBE 5: side-effect failure` — two tests. The first drives the outbox record to
  `dead_letter` with `attempts: 5`, exactly as Stage 9's worker would on a permanent failure, and
  re-reads the submission and contact afterwards: both intact, `submissionCount` unchanged. The
  second substitutes a geo provider that throws outright, and the submission still returns 202 and
  is stored with `geo: null`.
- **Why this shape:** Stage 7's side effect IS the durable outbox record, written inside the same
  transaction as the submission. Nothing consumes it yet, which is precisely why a failing consumer
  cannot reverse a lead — the separation is structural rather than defended.

### A6. Honeypot

- **Requirement:** A bot-like submission (filled honeypot or failed timing heuristic) receives a
  generic success outcome, creates no Contact, and records only a minimal Abuse Event with no
  captured form values (blueprint §7.3, §7.4).
- **Status:** `PROVEN`.
- **Command:** `npm run test:integration -- submission`
- **Evidence:** `PROBE 6: honeypot` — a good submission and a bot submission are sent to the same
  widget, and the test asserts their responses are **byte-identical**: same status, same body. It
  then shows no `Contact` exists for the bot's address, and that the only trace is an `AbuseEvent`
  of type `honeypot` carrying a pseudonym and nothing else — the assertions check explicitly that
  the bot's email, its message text, and the string `values` appear nowhere in the record, because
  §7.4's whole point is not turning rejected spam into a shadow lead database. A second test does
  the same for the timing heuristic.
- **Why byte-identical matters:** a bot that can tell it was caught will adapt. §7.3 step 10 asks
  for a uniform response, and the route writes the acknowledgement in exactly one place so the
  accepted and discarded paths cannot drift apart.

---

## Part B — Locked product decisions (blueprint §4)

### B1. Accounts, workspaces, and roles (§4.1)

- **Requirement:** Public registration; shared workspaces; a user may own one workspace and join
  many; Owner/Admin/Member roles; 7-day invitations; unverified users may use the dashboard but
  cannot publish or invite; Owner-only ownership transfer; 30-day workspace soft deletion.
- **Status:** `PROVEN` end to end. The API was proven in Stage 4a; Stage 4b added the interface
  and the browser tests that exercise it.
- **Every clause of section 4.1 now works and is tested:** public registration; shared workspaces
  with Owner/Admin/Member roles; a user owning at most one active workspace while joining many;
  first-workspace onboarding with a name and a confirmed IANA timezone; the Admins-manage-Members
  but Owner-assigns-Admins asymmetry; invitations by email link with a 7-day expiry; unverified
  users keeping dashboard access but being blocked from inviting; ownership transfer to a verified
  Admin; Owner-only workspace soft-delete with 30-day recovery; and the account-deletion
  precondition requiring the owned workspace to be resolved first.
- **Proven through the browser as well as the API.** 20 Playwright tests drive the real pages:
  onboarding creates the first workspace; a Member sees a read-only roster with no invite, role,
  remove, transfer, or delete control anywhere on it; an Admin is offered Member but never Admin
  when inviting, and cannot reach ownership or deletion; an unverified Owner is told to confirm
  their email rather than being refused generically; ownership transfer leaves the outgoing Owner
  an Admin; and a deleted workspace is restored from the recovery list.
- **What is still missing:** nothing in section 4.1 itself. The workspace name and timezone are
  read-only in the UI because no endpoint changes them yet, and the surrounding dashboard chrome
  is Stage 12; neither is a section 4.1 clause.
- **Evidence:** see Part D-detail, Stage 4a and Stage 4b.

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
- **Status:** `PROVEN`. The data model, field schema, and validation were proven at the API level
  in Stage 5a; Stage 5b added the settings form with its live preview and proved the same rules
  through the browser.
- **What is proven:** the three types are a locked union, not an open string; each type's mandatory
  fields cannot be removed OR quietly made optional; the CTA popover's email requirement applies
  only when its built-in lead form is enabled; a field type cannot appear twice; and appearance is
  a closed vocabulary of hex colours and enums, so no free-form style, class, HTML, or script value
  is representable anywhere in a configuration.
- **Also proven through the interface:** a locked field has no remove control at all rather than a
  disabled one; removing an optional field and adding another updates the preview immediately; and
  the preview renders the exact configuration that will be saved, because both read one object.
- **Evidence:** see Part D-detail, Stage 5a and Stage 5b.

### B4. Display, targeting, and visitor behavior (§4.4)

- **Requirement:** Inline/modal/floating modes; click, delay, scroll-depth, and exit-intent
  triggers; exact-host and explicit wildcard domain matching where `*.example.com` excludes
  `example.com`; safe glob page targeting; configurable cooldown; rotating per-widget pseudonymous
  visitor identifier; multiple instances sharing one runtime.
- **Status:** `PROVEN`. The settings and matching rules were proven in Stage 5a; Stage 6 executes
  them on a real page, including the rotating pseudonymous visitor identifier. What remains is not
  display behaviour: submissions arriving through the rendered form are **Stage 7**.
- **What is proven:** exact-host matching; `*.example.com` admitting `app.example.com` and
  `eu.app.example.com` but never the apex `example.com`, and never a lookalike such as
  `evilexample.com`; page include/exclude as safe globs where regular-expression syntax is treated
  as literal text; exclude beating include; and bounded trigger and cooldown shapes.
- **Evidence:** see Part D-detail, Stage 5a.

### B5. Publishing lifecycle (§4.5)

- **Requirement:** Stable widget identity with separately versioned revisions; Members edit drafts
  only; Owner/Admin publish to an immutable live revision; unpublishing immediately blocks config
  use and submissions at the backend; soft delete preserves historical contacts and events.
- **Status:** `PROVEN` for everything this stage can reach. The whole lifecycle is proven at the
  API level (5a) and through the browser (5b). The "blocks submissions" half of unpublishing still
  cannot be demonstrated until a submission endpoint exists (**Stage 7**); the state transition it
  depends on is built, persisted, and reflected in the UI.
- **What is proven:** a Member edits a draft while the live revision is byte-for-byte unchanged; a
  verified Owner/Admin publishes; an unverified one is refused with `email_not_verified`; a Member
  is refused publish and delete; editing a published widget opens a NEW revision rather than
  rewriting the live one; a stale draft write is refused with 409 instead of overwriting a
  teammate; and restoring from the 30-day trash deliberately does not republish.
- **Evidence:** see Part D-detail, Stage 5a.

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
- **Status:** `PROVEN` for everything except the public policy pages, which are **Stage 12**.
- **What is proven:** double opt-in is the default and a ticked box only becomes a subscription
  when the address confirms itself from its own inbox; every consent decision writes an immutable
  event carrying the wording shown, a fingerprint of that wording, the source, the widget revision,
  and a pseudonym; an unsubscribe stops marketing across the whole workspace and keeps doing so
  after the contact is deleted; an email-verified request exports one workspace's view of a contact
  or irreversibly erases it; and active-contact retention defaults to 12 months and is
  workspace-configurable across the four choices 4.8 names.
- **What is not:** the public privacy policy, terms, cookie notice, and acceptable-use pages are
  Stage 12. This stage built the mechanisms those documents will describe, not the documents.
- **Evidence:** see Part D-detail, Stage 11.

### B9. Analytics (§4.9)

- **Requirement:** Impression, open, CTA click, form start, and successful submission events;
  trends, funnel, per-widget, geo, source, status conversion, delivery health, and abuse
  dashboards; 90-day raw-event retention with daily aggregates thereafter.
- **Status:** `PROVEN` — all five events are ingested, aggregated, and rendered, and all eight
  dashboards read the aggregates.
- **What is proven:** the five funnel events travel the public endpoint through Origin, quota, and
  rate-limit checks into raw storage, roll up idempotently into daily counters, and are read back
  by one authenticated `workspace.view` endpoint that serves every dashboard. Seeded deterministic
  traffic renders the exact figures it implies, in the browser. Raw events retire at 90 days behind
  a sweep that aggregates a day before it can delete it, and the rendered figures survive that.
- **What is not:** the country and city dimensions are populated from submissions only; the ingest
  path deliberately does not call a geo provider for 20,000 events a month (blueprint 5.1 keeps
  that budget for the submission path), so those two dashboards are empty for widget traffic alone.
- **Evidence:** see Part D-detail, Stages 10a and 10b.

### B10. Usage limits (§4.10)

- **Requirement:** Visible meters and per-workspace hard limits of 10 active widgets, 10 users,
  2,000 accepted submissions per workspace month, and 20,000 interaction events per workspace
  month, using workspace-timezone month boundaries.
- **Status:** `PROVEN` — all four limits are enforced and all four meters report real counts.
- **What is proven:** the 10-user limit (Stage 4a) and the 10-active-widget limit (Stage 5a) are
  refused with `quota_exceeded`; the 2,000 submissions and 20,000 interaction-events per workspace
  month are counted and enforced on the WORKSPACE's timezone boundary, through one shared
  `monthStartInZone` so the meter and the gate cannot disagree about when a month turned. All four
  meters are rendered on the workspace overview, and both monthly ones announce themselves on the
  live stream.
- **Evidence:** see Part D-detail, Stages 5a, 7, and 10a.

---

## Part C — Security architecture checklist (blueprint §17)

The implementation is not complete until every item below is enforced and evidenced. All are
currently unproven. Consolidated verification happens in **Stage 13**, but each item is delivered
by the stage noted.

| #   | Requirement                                                                                 | Status                                                                                                                | Delivered by                         |
| --- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| C1  | Argon2id hashing and strong password rules                                                  | `PROVEN` - Argon2id 64MiB/t=3/p=4 with policy and breach blocking                                                     | Stage 3                              |
| C2  | Hashed single-use verification, reset, invitation, recovery, and privacy tokens with expiry | `PROVEN` for verification, reset, and recovery codes; privacy tokens in Stage 11                                      | Stages 3, 4, 11                      |
| C3  | Optional TOTP MFA and hashed recovery codes                                                 | `PROVEN` - optional TOTP with hashed single-use recovery codes                                                        | Stage 3                              |
| C4  | Redis sessions, rotation, expiry, device revocation, secure cookies, CSRF                   | `PROVEN` for sessions, rotation, expiry, revocation, cookies, and CSRF                                                | Stage 3                              |
| C5  | Generic auth responses and dedicated brute-force limits                                     | `PROVEN` - generic responses and per-flow throttles                                                                   | Stage 3                              |
| C6  | Mandatory workspace scope in every tenant query                                             | `PROVEN` - scope is session-derived and re-checked per request                                                        | Stage 2, enforced onward             |
| C7  | Role and verified-email gates on the server, never only in React                            | `PROVEN` - enforced server-side, and the UI hides controls using capabilities the SERVER derives from that same table | Stage 4                              |
| C8  | Strict Origin allowlist and correct CORS/preflight behavior                                 | `NOT YET IMPLEMENTED`                                                                                                 | Stages 6, 7                          |
| C9  | Platform-owned payload schemas and 32 KB body limit                                         | `NOT YET IMPLEMENTED`                                                                                                 | Stage 7                              |
| C10 | Honeypot, timing heuristic, rate limits, quotas, 24-hour idempotency                        | `NOT YET IMPLEMENTED`                                                                                                 | Stage 7                              |
| C11 | No raw IP persistence and monthly HMAC rotation                                             | `NOT YET IMPLEMENTED`                                                                                                 | Stage 7                              |
| C12 | Encryption of readable secrets with key-version support                                     | `PROVEN` for the TOTP secret - AES-256-GCM with key version                                                           | Stages 3, 9                          |
| C13 | Output escaping, safe template variables, no arbitrary HTML/CSS/JS                          | `IN PROGRESS` - auth UI escapes output and accepts no HTML; widget templates in Stages 5, 6, 9                        | Stages 5, 6, 9                       |
| C14 | Validated redirects and CTA destinations                                                    | `NOT YET IMPLEMENTED`                                                                                                 | Stages 5, 6                          |
| C15 | Webhook SSRF defenses and HMAC signing                                                      | `NOT YET IMPLEMENTED`                                                                                                 | Stage 9                              |
| C16 | Security headers and an appropriate Content Security Policy                                 | `NOT YET IMPLEMENTED`                                                                                                 | Stage 13                             |
| C17 | PII and secret redaction in logs, errors, analytics, and monitoring                         | `NOT YET IMPLEMENTED`                                                                                                 | Stage 13                             |
| C18 | Dependency review, lockfile integrity, vulnerability and secret scanning in CI              | `IN PROGRESS` - detail below                                                                                          | Stage 1 baseline, completed Stage 13 |
| C19 | Immutable audit and submission evidence within retention windows                            | `IN PROGRESS` - AuditEvent 12-month TTL verified                                                                      | Stages 2, 7, 11                      |

---

## Part D — Cross-cutting architecture proofs (blueprint §7–§16)

| #   | Requirement                                                                                                | Status                                                                                                                                                                                          | Delivered by                   |
| --- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| D1  | Tenant isolation: two seeded tenants cannot reach each other through any repository                        | `PROVEN` for foundation repositories - see Part D-detail                                                                                                                                        | Stage 2, re-proven per surface |
| D2  | Tenant isolation across CRUD, search, export, analytics, SSE, trash, and recovery                          | `IN PROGRESS` - membership, invitation, audit, and workspace recovery paths proven isolated, at the API and now through the browser; export, analytics, SSE, and contact trash do not exist yet | Stages 8, 10                   |
| D3  | Cache contract: 5-minute loader, 1-year immutable hashed runtime, 60-second config with ETag               | `PROVEN` - asserted both at the API and on the headers a real browser received                                                                                                                  | Stage 6                        |
| D4  | A cached config cannot bypass unpublishing, deletion, a domain-rule change, or a quota block               | `IN PROGRESS` - the server stops serving immediately on all four; the submission-side half of the guarantee needs a submission endpoint                                                         | Stages 6, 7                    |
| D5  | All three widget types render on a separate origin, multiple instances coexist, host CSS cannot break them | `PROVEN` - see Part D-detail, Stage 6                                                                                                                                                           | Stage 6                        |
| D6  | Public config never leaks recipients, webhook URLs/secrets, notes, or tenant identifiers                   | `PROVEN` - the response is an allowlist, asserted key by key                                                                                                                                    | Stage 6                        |
| D7  | Outbox prevents a transient Redis enqueue failure from losing promised work                                | `NOT YET IMPLEMENTED`                                                                                                                                                                           | Stages 7, 9                    |
| D8  | Transient-only retry, five attempts with backoff, dead letter, and manual replay                           | `NOT YET IMPLEMENTED`                                                                                                                                                                           | Stage 9                        |
| D9  | Brevo daily budget priority reserve and visible deferred states                                            | `NOT YET IMPLEMENTED`                                                                                                                                                                           | Stage 9                        |
| D10 | SSE workspace isolation, heartbeats, and bounded reconnect                                                 | `NOT YET IMPLEMENTED`                                                                                                                                                                           | Stages 8, 10                   |
| D11 | Raw interaction events expire after 90 days leaving aggregates intact                                      | `NOT YET IMPLEMENTED`                                                                                                                                                                           | Stage 10                       |
| D12 | Every recovery window and permanent purge (contact, widget, workspace, account)                            | `NOT YET IMPLEMENTED`                                                                                                                                                                           | Stage 11                       |
| D13 | Repeatable migrations and explicit index management on a clean database                                    | `PROVEN` - see Part D-detail                                                                                                                                                                    | Stage 2                        |
| D14 | Liveness and readiness endpoints; degraded optional providers do not make the API unready                  | `IN PROGRESS` - detail below                                                                                                                                                                    | Stage 1 skeleton, Stage 13     |
| D15 | WCAG 2.2 AA audit with zero critical automated violations on critical pages and widgets                    | `IN PROGRESS` - axe clean on every auth page; manual audit and full page set in Stage 13                                                                                                        | Stage 13                       |
| D16 | CI installs, type-checks, lints, tests, and builds every workspace before merge                            | `IN PROGRESS` - detail below                                                                                                                                                                    | Stage 1, extended per stage    |
| D17 | One documented local command starts dependencies and apps; seed data is reproducible                       | `IN PROGRESS` - detail below                                                                                                                                                                    | Stage 1                        |
| D18 | Clean deployment from main passes smoke, cross-origin, auth, queue, and restore checks                     | `NOT YET IMPLEMENTED`                                                                                                                                                                           | Stage 14                       |
| D19 | Encrypted export/restore rehearsal succeeds                                                                | `NOT YET IMPLEMENTED`                                                                                                                                                                           | Stage 14                       |
| D20 | Render sleep delays but does not permanently skip retention or queue work                                  | `IN PROGRESS` - the bounded startup catch-up sweep is built and proven against a clock jump; unproven on a real sleeping instance until Stage 14 deploys one                                    | Stages 11, 14                  |

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

## Part D-detail - Stage 4b workspace UI and browser evidence

### B1 completed: the role matrix, proven through the interface

Stage 4a proved the server refuses forbidden calls. The gate for blueprint Stage 4 says "from API
through browser", which is a different claim: that the interface does not offer a control it would
then be refused for using.

```
npm run test:e2e
  37 passed (5.2m)
```

Twenty of those are new. The ones that carry the gate:

| Test                                                                   | What it establishes                                                                                                                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `an Owner invites a Member, who sees a read-only roster`               | A Member sees the roster and no invite, role, remove, transfer, or delete control; the audit link is absent, and typing the audit URL still fails                              |
| `an Admin can invite and remove Members but cannot touch Admin status` | The invite role list contains exactly Member; ownership and deletion controls are absent; the Owner row offers neither Remove nor a role control; a Member is actually removed |
| `only the Owner is offered the Admin role when inviting`               | The same list contains exactly Member and Admin for the Owner                                                                                                                  |
| `an unverified user is blocked from inviting, and told why`            | The invite form is absent and the page says to confirm the address, rather than showing a control that would 403                                                               |
| `an intercepted invitation link does not let a different account in`   | A signed-in stranger gets the same answer as a made-up token, joins nothing, and the real invitation stays pending                                                             |
| `ownership transfers to a verified Admin`                              | The outgoing Owner keeps access as an Admin and loses the transfer and delete controls; the incoming Owner gains them                                                          |
| `switching workspaces re-scopes what is shown`                         | The same person is Member in one workspace and Owner in another; the audit link and delete control appear and disappear accordingly                                            |
| `a workspace can be deleted and restored inside the 30-day window`     | Soft delete, the recovery list, and restoration, all through the UI                                                                                                            |

### C7. One copy of the policy, not two

The UI hides controls, but it does not decide anything. `GET /workspaces/current` returns the
capability list the server computed with `can()`, and `GET /members` returns per-member
`assignableRoles` and `canRemove` computed with `canChangeRole()` and `canRemoveMember()` - the
same functions the mutation routes enforce with.

```
LSP findReferences on can() in apps/server/src/domain/workspace/capabilities.ts
  19 references across 4 files:
    domain/workspace/capabilities.ts   (definition, canChangeRole, canRemoveMember)
    http/middleware/workspace.ts       (requireCapability - the enforcement)
    http/routes/workspaces.ts          (deriving the list the UI reads)
    tests/rbac.test.ts                 (the matrix assertions)
```

Four integration tests assert the derived answers directly, including that an unverified Owner is
given `workspace.view` but not `member.manage`, and that an Admin is told they may remove a Member
but not promote one.

### Accessibility

`axe` at WCAG 2.2 AA on every new page, with zero critical or serious violations. The scans cover
error and empty states as well as populated ones: onboarding with a rejected timezone, an
invitation page with an invalid token, an invitation page opened while signed out, an empty pending
list, a populated one, the danger zone mid-confirmation, and the switcher while open. One test
completes a navigation with the keyboard alone.

### The gap Stage 4a left, and how it was closed

A soft-deleted workspace is deliberately hidden from the switcher and can never be the active
workspace, so `requireWorkspaceContext` refuses it. That left no way for an owner to name the
workspace they were entitled to restore once the page reloaded: recovery existed but was
unreachable. Stage 4b added `GET /workspaces/recoverable`, filtered to workspaces the caller owns
that are still inside the window, and surfaced it on the onboarding screen - which is exactly where
someone who has just deleted their only workspace ends up.

---

## Part D-detail - Stage 5a widget backend evidence

### The Stage 5 exit gate, at the API level

The gate is three claims. Each is a named, re-runnable test in
`apps/server/tests/widget.integration.test.ts`:

| Claim                                              | Test                                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| A Member edits a draft without changing live state | `a Member edits a draft without changing live state`                       |
| A verified Admin publishes                         | `a verified Admin publishes, creating an immutable live revision`          |
| Another tenant cannot read, modify, or publish it  | `another tenant cannot read, modify, publish, delete, or recover a widget` |

The first asserts the published revision's headline and revision number are unchanged after the
Member's save, and that the Member's own publish attempt is refused with `forbidden`. The third is
a sweep rather than a single case: read, list, draft write, publish, unpublish, delete, and recover
are each attempted by a second tenant and each answers 404, after which the owner's widget is
re-read and found byte-for-byte unchanged.

```
npm test
  Test Files  8 passed (8)
       Tests  162 passed (162)

npm run test:integration
  Test Files  7 passed (7)
       Tests  131 passed (131)
```

### Blueprint 9.2 constraints, enforced in storage rather than in code

Migration `005_widget` was applied to a real database and the indexes read back:

```
npm run migrate      applied 4, skipped 1   (005_widget applied)
npm run migrate      applied 0, skipped 5   (repeatable, per blueprint 9.3)

widgets
  uniq_public_id                   { publicId: 1 }                                  unique
  workspace_status                 { workspaceId: 1, status: 1 }
  status_purge_after               { status: 1, purgeAfter: 1 }
widget_revisions
  uniq_workspace_widget_revision   { workspaceId: 1, widgetId: 1, revisionNumber: 1 } unique
  uniq_widget_draft                { workspaceId: 1, widgetId: 1 }  unique, partial { status: 'draft' }
  workspace_widget_revision_desc   { workspaceId: 1, widgetId: 1, revisionNumber: -1 }
```

`uniq_widget_draft` is the one index blueprint 9.2 does not list. It encodes "creates or updates a
draft revision" (4.5, singular): at most one draft may exist per widget, enforced by the storage
engine rather than by every write path remembering to check.

### C7 extended: widget routes reuse the existing matrix rows

No capability name was invented for this stage. `CAPABILITIES` still has 16 entries, and the three
widget rows were already present and unit-tested before any widget route existed:

```
widget.draft.write  owner allow                  admin allow                  member allow
widget.publish      owner requires_verified_email admin requires_verified_email member deny
widget.delete       owner allow                  admin allow                  member deny
```

Reading falls under `workspace.view`, the same row the workspace-context and members endpoints
already use; section 11 has no separate "view widgets" row.

### Section 17 rows this stage touches

- **Platform-owned payload schemas.** Every configuration is re-validated server-side against the
  locked field-type list and the per-type mandatory rules on both draft write AND publish, so a
  configuration that became invalid after a later change cannot be published around.
- **No arbitrary HTML/CSS/JS.** Appearance is hex colours plus enums. A test feeds
  `red; background: url(javascript:alert(1))` into a colour and asserts the schema refuses it.
- **Validated redirects and CTA destinations.** Only `http:` and `https:` are accepted, by
  allowlist rather than denylist; `javascript:`, `data:`, `vbscript:`, and `file:` are each
  asserted rejected, as are embedded credentials such as
  `https://evil.example.com@bank.example.com/`.

### Safe globs, demonstrated rather than asserted

Blueprint 4.4 requires "safe glob patterns rather than executable regular expressions". The
translator escapes every metacharacter before reintroducing exactly two wildcards, and a test
pins the compiled output:

```
compilePagePattern('/blog/**/*.html')  ->  ^\/blog\/.*\/[^/]*\.html$
```

Further tests assert that `/a.b` does not match `/axb`, that `/(a|b)` does not match `/a`, and
that `/x+` does not match `/xxx` - i.e. regex syntax is inert text. No nested quantifier or
alternation is reachable, so the expression cannot backtrack catastrophically.

### A defect only the full suite found

The page that completes a privacy request had no guard against its own effect firing twice, which
React does in development. The first call consumed the single-use token, the second was correctly
refused, and the refusal won the render - so an export that succeeded on the server was reported to
the person as an invalid link, with the link now genuinely spent.

Worth recording because of how it presented: the test passed in isolation and failed in the full
suite, purely because load changed which response landed last. The obvious reading was a flaky
test. Both token-consuming pages now record which token they have already acted on.

### What is still missing

- The React builder, its live preview, the embed-snippet UI, and the browser journey (Stage 5b).
- The public loader route and framework-free runtime; the snippet's shape and public identifier
  are real and stable, but nothing serves them yet (Stage 6).
- The submission endpoint, so the "unpublishing blocks submissions" half of B5 is persisted but
  not yet demonstrable (Stage 7).
- Config cache invalidation on publish (blueprint 8.2) - there is no config cache until Stage 6.
- The scheduled purge of expired widget trash (Stage 11); the 30-day window is enforced on read.

---

## Part D-detail - Stage 5b builder, preview, and browser evidence

### Blueprint Stage 5's exit gate, through the browser

The gate is three claims. Stage 5a proved each against the API; these prove them against the
interface, which is a different claim - that the UI never offers a control it would then be refused
for, and that a draft edit visibly leaves the live revision alone.

| Claim                                              | Test (`e2e/tests/widget-journey.spec.ts`)                        |
| -------------------------------------------------- | ---------------------------------------------------------------- |
| A Member edits a draft without changing live state | `a Member edits a draft without changing live state - EXIT GATE` |
| A verified Admin publishes                         | `a verified Admin publishes and copies the snippet`              |
| Another tenant cannot read, modify, or publish it  | `another tenant cannot reach a widget through the UI`            |

The first is the one worth reading closely. After the Member saves, the builder correctly shows
THEIR text, because the builder edits the draft. What must not have moved is the live revision, so
the test asserts the separate "Live now" panel still reports `Original headline` at revision 1, that
the list marks the widget as having unpublished changes, and that a direct `POST /publish` from the
Member's own session answers 403.

```
npm run test:e2e
  57 passed (8.4m)
```

Twenty of those are new: 12 journeys and 8 accessibility scans.

### One copy of the rules, extended to the builder

Stage 4b established that the UI must not keep its own copy of the policy. The same principle
applied here to the per-type mandatory-field rule, which the builder needs in order to decide
whether to render a remove control:

```
LSP findReferences on mandatoryFieldsFor in packages/contracts/src/widget.ts
  7 references across 3 files:
    packages/contracts/src/widget.ts              (the single declaration)
    apps/web/src/components/WidgetSettings.tsx    (which fields may be removed)
    apps/server/src/domain/widget/fields.ts       (which configurations are valid)
```

It was moved out of the server's domain folder into the shared package for exactly this reason. The
publish, unpublish, and delete controls key off the capability list the API derives from the section
11 matrix, unchanged from Stage 4b.

### Accessibility

`axe` at WCAG 2.2 AA on every new page, zero critical or serious violations, covering the empty
list, the populated list, the builder with every conditional section revealed, the builder mid-error,
the builder mid-delete-confirmation, a published widget with its snippet, a CTA popover with no form
section, the trash view, and the builder as a Member. One test completes an edit with the keyboard
alone and watches the preview follow.

**One real defect was found and fixed by these scans.** The preview muted whole field elements with
`opacity: 0.55`, which rendered placeholder text as `#7e7f8a` on white - 3.96:1, below the 4.5:1 AA
requires. Borders and text now scale separately, because a border is non-text and needs only 3:1.
This would have been inherited by the Stage 6 runtime had it not been caught here.

### A defect only the full suite found

The page that completes a privacy request had no guard against its own effect firing twice, which
React does in development. The first call consumed the single-use token, the second was correctly
refused, and the refusal won the render - so an export that succeeded on the server was reported to
the person as an invalid link, with the link now genuinely spent.

Worth recording because of how it presented: the test passed in isolation and failed in the full
suite, purely because load changed which response landed last. The obvious reading was a flaky
test. Both token-consuming pages now record which token they have already acted on.

### What is still missing

- Nothing renders a widget on a real customer page. The loader route named in the snippet does not
  exist until Stage 6, and the preview is the dashboard's own rendering rather than the runtime's.
- Targeting, triggers, and cooldown are stored and validated, never executed (Stage 6).
- The submission endpoint, so the "unpublishing blocks submissions" half of B5 remains
  undemonstrable (Stage 7).
- The builder does not warn about a low-contrast colour pairing a creator chooses; the preview
  renders it faithfully, including its poor contrast.

---

## Part D-detail - Stage 6 public loader and runtime evidence

### D5. The exit gate, on a genuinely separate origin

Every test below runs against `apps/demo` on port 5174 while the platform runs on 5173. The
separation is the point: a same-origin test would prove nothing about the Origin allowlist, CORS,
or the widget being a guest on a page it does not control.

| Claim                            | Test (`e2e/tests/widget-runtime.spec.ts`)                                                                        |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| All three types render           | `a contact form renders inline...`, `an email signup renders...`, `a CTA popover renders as a floating panel...` |
| Multiple instances coexist       | `two widgets coexist on one page with one runtime load`                                                          |
| Host CSS cannot break them       | `hostile host CSS does not reach into the widget`                                                                |
| Widget CSS does not escape       | `widget CSS does not leak out onto the host page`                                                                |
| Cache headers match the contract | `loader, runtime, and config carry the headers the contract specifies`                                           |

The demo page is deliberately hostile. It sets `* { box-sizing: content-box !important }`,
restyles every input with `!important` at 40px, and reuses the class name `.panel` that the
widget's own stylesheet uses internally. The isolation tests read computed styles on both sides of
the boundary and assert neither crosses it.

Multi-instance is checked by counting requests rather than by eye: two snippet tags produce exactly
one runtime fetch and two config fetches, which is blueprint 8.1's "multiple script tags share one
runtime" stated as an assertion.

```
npm run test:e2e
  72 passed
```

Fifteen of those are new.

### D3. The cache contract, as a browser actually received it

```
loader.js                      cache-control: public, max-age=300
runtime.<16-hex-hash>.js       cache-control: public, max-age=31536000, immutable
config/<publicId>              cache-control: public, max-age=60
                               etag: "w-<publicId>-<revision>"
                               vary: Origin
                               access-control-allow-origin: http://localhost:5174
```

Two details worth stating. `Vary: Origin` is there because the answer depends on the Origin: without
it a shared cache could hand one site's allowed response to a site that is not on the allowlist. And
the ETag is derived from the public id and revision number rather than from a hash of the body, so
it is stable across processes and restarts; a body hash would change with incidental things like key
order. Requesting the runtime under any other hash answers 404 rather than serving current bytes
under a stale URL, which is what makes a one-year immutable cache safe.

### D6. The public config is an allowlist, not a filtered record

`toPublicConfig` names the fields that go out rather than removing the ones that must not, so a
later stage adding a private setting cannot leak it by default. The integration test asserts the
exact key set and that the response contains no `allowedDomains`, no `workspaceId`, no
`ownerUserId`, and no `_id`.

The allowlist itself is the interesting omission: it is not secret, but it is not renderable
either, the server is the authority on it, and shipping it to the client it constrains invites
tampering.

### D4. Server state, checked on every config request

Each of these has its own integration test, and each stops the server serving immediately:
unpublishing, soft-deleting the widget, soft-deleting the owning workspace, and republishing with a
different allowed-domain list. A browser that already holds a config may legitimately keep it for up
to 60 seconds, which is what blueprint 8.2 permits - so the browser test proves the point with a
FRESH context and an empty cache rather than pretending the TTL does not exist. The submission-side
half of this guarantee arrives with the endpoint it describes, in Stage 7.

### Bundle budgets (blueprint 8.3)

Blueprint 8.3 asks for budgets to be established by measurement rather than promised in advance, so
these were measured first and the ceilings set around them:

```
widget runtime   13,613 B raw    5,439 B gzip     budget 20,480 / 8,192
widget loader       734 B raw      434 B gzip     budget  2,048 / 1,024
```

CI prints both on every run, and the unit suite fails the build if either exceeds its ceiling. A
separate test asserts directly that the strings `react` and `zod` appear nowhere in the bundle -
"no dashboard framework enters the widget bundle" checked as a fact rather than inferred from a
size. That test also guards a real hazard: the shared contracts package depends on Zod, so
importing its barrel instead of the zero-dependency `@lcp/contracts/rules` entry point would pull a
validation library onto customer websites.

### One implementation of the matching rules

Stage 5a's host/wildcard matching, safe-glob page matching, and URL validation moved from
`apps/server/src/domain/widget/` into `@lcp/contracts` for this stage, because blueprint 7.2 splits
the work between the two sides: the backend confirms the Origin (step 5) and the runtime evaluates
include/exclude patterns against the real page URL (step 7). The server's original module paths
remain as re-export shims so existing imports and their tests are untouched.

```
LSP findReferences on isPageTargeted
  used by packages/widget-runtime/src/instance.ts   (step 7, in the browser)
  used by apps/server/src/domain/widget/            (re-export shim)
  declared once in packages/contracts/src/widget-rules.ts
```

### Accessibility of the rendered widget

`axe` at WCAG 2.2 AA runs against the demo page with the widget mounted, so the scan covers the
widget as a visitor meets it - inside a shadow root, on a page with its own styles. axe traverses
open shadow roots, which is one of the reasons the root is open rather than closed. A separate test
completes a form interaction with the keyboard alone.

Focus behaviour is deliberately split: a modal opened by a visitor's click takes focus and traps
Tab until Escape, then returns focus to the control that opened it; a popover that appears on a
timer takes no focus at all and announces itself politely instead, because moving focus under
someone mid-task is hostile.

### A defect only the full suite found

The page that completes a privacy request had no guard against its own effect firing twice, which
React does in development. The first call consumed the single-use token, the second was correctly
refused, and the refusal won the render - so an export that succeeded on the server was reported to
the person as an invalid link, with the link now genuinely spent.

Worth recording because of how it presented: the test passed in isolation and failed in the full
suite, purely because load changed which response landed last. The obvious reading was a flaky
test. Both token-consuming pages now record which token they have already acted on.

### What is still missing

- The public submission endpoint. The form renders and validates in the browser but posts nowhere;
  the runtime has a typed seam where Stage 7 attaches.
- Interaction events, so nothing yet records that a widget was seen or opened (Stage 10).
- Config cache invalidation in Redis on publish (blueprint 8.2). The 60-second TTL is honoured and
  the server always answers from current state, but there is no cache layer to invalidate yet.
- The runtime bundle is hashed once at server startup, so a rebuild needs a restart.

---

## Part D-detail - Stage 7 submission path evidence

### The request gate, in blueprint order

Blueprint 7.3 lists eleven numbered rules and the order is load-bearing, so the service follows it
literally: widget and Origin, then schema, then idempotency, then heuristics, then quota, then geo,
then one commit, then side effects. Each has its own test.

```
npm test                    Test Files 11 passed (11)   Tests 204 passed (204)
npm run test:integration    Test Files  9 passed (9)    Tests 171 passed (171)
```

Twenty-one of the unit tests and twenty-five of the integration tests are new.

### Migration 006, applied and read back

```
npm run migrate     applied 1, skipped 5   (006_submissions)
npm run migrate     applied 0, skipped 6   (repeatable, per blueprint 9.3)

contacts
  uniq_active_workspace_email   { workspaceId, normalizedEmail }  unique, partial { recordStatus: 'active' }
  workspace_last_submission     { workspaceId, lastSubmissionAt }
  workspace_status_date         { workspaceId, status, lastSubmissionAt }
  workspace_assignee            { workspaceId, assigneeUserId }
  workspace_tags                { workspaceId, tags }
  record_status_purge_after     { recordStatus, purgeAfter }
submission_events
  workspace_contact_date        { workspaceId, contactId, submittedAt }
  workspace_widget_date         { workspaceId, widgetId, submittedAt }
  workspace_domain_date         { workspaceId, source.domain, submittedAt }
  workspace_country             { workspaceId, geo.countryCode }
  uniq_workspace_idempotency_key{ workspaceId, idempotencyKey }    unique
consent_events
  workspace_contact_date        { workspaceId, contactId, occurredAt }
abuse_events
  workspace_widget_type_date    { workspaceId, widgetId, type, occurredAt }
  ttl_occurred_at               { occurredAt }                     ttl 7776000s (90 days)
```

`uniq_workspace_idempotency_key` is the index worth explaining. Redis holds the 24-hour replay
answer, but Redis is a cache that can be flushed - so "a retry creates no duplicate event" is
enforced by the database as well, and survives losing the cache entirely.

### C-row: no raw IP is ever persisted (blueprint 9.4)

The address is used for rate limiting and geo and then discarded. What lands is a rotating HMAC
pseudonym, and a test asserts the stored event contains a 64-hex value and none of `127.0.0.1`,
`::1`, or an `ipAddress` field.

The construction matters: an HMAC rather than a plain hash, because the IPv4 space is small enough
to enumerate completely - a SHA-256 of an address is not a pseudonym, it is a lookup table waiting
to happen. The per-period subkey is derived from the master secret, so rotation needs no new secret
provisioned and a leaked period key exposes one month rather than all of them. Unit tests cover
stability within a period, a different value after the month turns, separation between addresses,
and that the value changes completely if the key material does.

### Tenancy on the new write paths (blueprint 9.1)

Every contact, submission event, consent event, and outbox row carries a `workspaceId`, and a test
asserts the two tenants' rows never mix across all three collections. A second test proves the same
visitor email in two workspaces produces TWO independent contacts - contacts are unique per
workspace, not globally, because one person contacting two customers is two separate leads.

### A defect only the full suite found

The page that completes a privacy request had no guard against its own effect firing twice, which
React does in development. The first call consumed the single-use token, the second was correctly
refused, and the refusal won the render - so an export that succeeded on the server was reported to
the person as an invalid link, with the link now genuinely spent.

Worth recording because of how it presented: the test passed in isolation and failed in the full
suite, purely because load changed which response landed last. The obvious reading was a flaky
test. Both token-consuming pages now record which token they have already acted on.

### What is still missing

- The contact inbox, so A1's "visible dashboard result" is a stored record rather than a screen
  (Stage 8).
- Real queue processing. Stage 7 writes the durable outbox row; nothing consumes it, and the
  email/webhook delivery, retry, backoff, and dead-letter behaviour of blueprint 12.2 are Stage 9.
- Interaction events and analytics counters (Stage 10).
- The consent confirmation and unsubscribe workflow; Stage 7 records opt-in evidence only
  (Stage 11).
- SSE live arrival: the submission commits, but nothing broadcasts it yet (Stage 10).

---

## Part D-detail - Stage 8a contact inbox backend evidence

Stage 8 is split. **8a is the API, persistence, and SSE stream; there is no UI in it**, so the exit
gate is stated at the API level and browser proof belongs to 8b.

### The three gate claims, each with a named test

```
npm test                    Test Files 12 passed (12)   Tests 238 passed (238)
npm run test:integration    Test Files 10 passed (10)   Tests 209 passed (209)
```

Thirty-four of the unit tests and thirty-eight of the integration tests are new. The integration
file names its gates directly, so a reader can find them rather than trust a summary:

| Gate | Test                                                           | What it proves                                                                                                                                                                                                                                                    |
| ---- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `GATE 1: role-aware access` (6 tests)                          | Every role may set status, assignee, tags, and notes; a Member is refused a canonical edit, a merge, an export, the trash, a soft-delete, and a recovery; an Admin is allowed all of them; an unauthenticated caller gets 401 everywhere including the SSE stream |
| 2    | `GATE 2: export matches the active filter` (5 tests)           | `?status=qualified` exports exactly the two rows the same filter lists and neither of the two it excludes; the JSON format agrees; the header is an allowlist, not a record dump; a formula is neutralised; the audit entry names actor, format, and row count    |
| 3    | `GATE 3: live contact.created is workspace-isolated` (3 tests) | A submission delivers `contact.created` to its own workspace stream and the other tenant's stream sees nothing; a repeat submission raises `contact.updated` instead; a removed member cannot open a stream at all                                                |

### Migration 007, applied and read back

```
npm run migrate     applied 1, skipped 6   (007_contact_inbox)
npm run migrate     applied 0, skipped 7   (repeatable, per blueprint 9.3)

contact_activities
  workspace_contact_date        { workspaceId, contactId, occurredAt }
contacts (added by 007)
  workspace_status_date_id      { workspaceId, recordStatus, lastSubmissionAt, _id }
  workspace_created             { workspaceId, recordStatus, createdAt, _id }
  workspace_email_sort          { workspaceId, recordStatus, normalizedEmail, _id }
  workspace_merged_into         { workspaceId, mergedIntoContactId }
submission_events (added by 007)
  workspace_page_url            { workspaceId, source.pageUrl }
  workspace_city                { workspaceId, geo.city }
```

The four-part contact keys are the ones worth explaining. Migration 006 indexed
`{ workspaceId, lastSubmissionAt }`, which is not the shape the inbox actually queries: every list
also filters `recordStatus` and sorts with `_id` as a tiebreaker. MongoDB's documentation states
plainly that `$sort` is not a stable sort and that a unique field must be included for deterministic
order - and that tiebreaker is also what lets a keyset cursor resume from an exact position, so one
index serves both.

### No new capability names, no matrix edits

`apps/server/src/domain/workspace/capabilities.ts` is **unchanged in this stage** - `git diff` on it
is empty. The five contact capabilities were transcribed in Stage 4 and asserted cell by cell in
`tests/rbac.test.ts` before any route existed to use them; Stage 8a attaches to them.

The bulk endpoint is the one place a second role table would have been tempting, because blueprint
4.7 states the Owner/Admin-vs-Member split in prose. It maps each action to a capability instead and
asks the same `can()`; `typescript-lsp` go-to-definition on that call resolves to
`domain/workspace/capabilities.ts:115`, not to a local copy.

### Tenancy on the new paths (blueprint 9.1)

A cross-tenant test exists per path, not one representative case: read, list, workflow write, note,
canonical edit, merge, soft-delete, recover, bulk, export, activity history, and SSE. The bulk case
is the one that says something the others cannot - the request is well-formed and the caller may
bulk-edit in their OWN workspace, so it returns 200 with `changed: 0`, which proves the scope is
applied to the write and not only to the read.

### A defect only the full suite found

The page that completes a privacy request had no guard against its own effect firing twice, which
React does in development. The first call consumed the single-use token, the second was correctly
refused, and the refusal won the render - so an export that succeeded on the server was reported to
the person as an invalid link, with the link now genuinely spent.

Worth recording because of how it presented: the test passed in isolation and failed in the full
suite, purely because load changed which response landed last. The obvious reading was a flaky
test. Both token-consuming pages now record which token they have already acted on.

### What is still missing

- The inbox UI, the timeline UI, bulk-action controls, and export controls (8b), along with this
  stage's browser E2E.
- Real queue processing: `contact.created` reaches the stream, but nothing consumes the outbox row
  the submission wrote, so no email or webhook is sent (Stage 9).
- The reconnect replay buffer is process-local and holds 50 events. It closes the sub-second gap of
  an ordinary reconnect; it is not durable history, and a client away longer refetches the list.
- Only contact events are published. Submission, usage, and delivery events are named in the
  contract so Stages 9 and 10 attach to a stream that already knows them, but nothing raises them.
- Permanent purge of trashed contacts after 30 days is scheduled by `purgeAfter` but not yet swept
  (Stage 11).

---

## Part D-detail - Stage 8b inbox UI and browser evidence

8b puts a role-aware interface on 8a's API and proves blueprint Stage 8's gate through the browser,
the way 4b and 5b closed Stages 4 and 5. **Stage 8 is complete with this sub-stage.**

### The three gate claims, proven through the UI

```
npm run test:e2e     88 tests passed
```

Sixteen of those are new. The gate tests name themselves so a reader can find them:

| Gate | Test                                                  | What the browser actually did                                                                                                                                                                                                                                                                                                             |
| ---- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `GATE 1: role-aware inbox` (2 tests)                  | A real Member, in their own browser context, opened the inbox: no export control, no trash link, no merge button, no soft-delete in the bulk bar, and no canonical-edit panel on the detail page. They then DID set a status, add a tag, and write a note. An Owner, in the same fixture shape, saw every control the Member was refused. |
| 2    | `GATE 2: export matches the active filter` (1 test)   | Qualified one of two leads through the bulk bar, filtered the inbox to `qualified`, clicked Export CSV, and read the downloaded bytes: the qualified lead is present, the other is absent, and the header carries no `workspaceId`.                                                                                                       |
| 3    | `GATE 3: live arrival is workspace-isolated` (1 test) | Two owners in two browser contexts sat on their own inboxes. A lead was submitted to one. That page raised "1 new lead arrived" **without any reload**, and showed the lead when pressed. The other tenant's open page never received it.                                                                                                 |

Six more cover the journeys around the gate: a canonical edit that survives a later submission, a
stale edit that conflicts instead of overwriting, a merge that retires the duplicate, search by a
word that appears only inside a captured message, trash and recovery, and a cross-tenant check that
uses the other workspace's exact contact URL rather than only its list.

### Accessibility (blueprint 14.1, WCAG 2.2 AA)

Six new axe scans, on the same tag set every other surface uses
(`wcag2a wcag2aa wcag21a wcag21aa wcag22aa`), failing on any critical or serious violation:

- the inbox empty, populated, with the filter disclosure open, with the bulk bar showing, and with
  the merge panel open;
- the no-results empty state, which carries a different message from the never-had-a-lead one;
- the lead detail page, with both timeline weights on screen;
- the optimistic-concurrency **conflict** state;
- the trash, empty and populated;
- a keyboard-only pass: search focused, the filter disclosure toggled with Enter, a row selected
  with Space, and a lead opened with Enter.

### What the browser caught that review did not

**Export was unreachable.** It had been placed inside the filter disclosure, which is collapsed by
default - so an Owner looking for it would not have found it. `toBeVisible()` failed, and the fix
was a design fix, not a selector fix: export now sits beside the disclosure, always visible, next to
the "N active" badge that says how narrow the list currently is.

**A flaky test was a real defect.** The Member gate test failed intermittently, and only in a
multi-file run: the bulk bar was absent after a row was checked, because `load()` cleared the
selection and StrictMode's double-invoked mount effect landed the second load after the click. The
underlying bug was that any refresh silently discarded a selection somebody had just made. The list
now prunes the selection to rows still present rather than clearing it.

**A suite can adopt a server it does not own.** Playwright's `reuseExistingServer` caused two
opposite failures. Once it handed the suite a stale server that predated Stage 7's submit route;
once the adopted API server was reaped mid-run by its real owner, and every test from #19 onward
failed with uniform ~12-second errors across specs that had just passed. Neither looks like what it
is from the test output; `curl /health/live` told both apart in seconds.

**A stale API server passed for a missing route.** The first run failed every submission with a 404
whose body was the catch-all message rather than the submission service's. The long-running dev
server predated Stage 7's submit route, and `reuseExistingServer` had kept it alive across stages.

### One copy of the policy, verified rather than asserted

There is no role table in the inbox UI. Grepping the new pages for `'owner'`, `'admin'`, or
`'member'` returns nothing; every affordance reads a capability the SERVER derived - `contact.export`,
`contact.delete`, `contact.workflow.write`, `contact.canonical.write` - or the `allowedActions` list
8a returns per contact.

### One thing fixed in passing

`capstone.yaml` still carried `test_integration: TBD # filled_in_by: Stage 2` and
`test_e2e: TBD # filled_in_by: Stage 6`. Both commands have worked for several stages, and the
README tells an evaluator that anything marked TBD "does not work today" - so the file was
understating the project. Both are now filled in with their real commands and counts.

### A defect only the full suite found

The page that completes a privacy request had no guard against its own effect firing twice, which
React does in development. The first call consumed the single-use token, the second was correctly
refused, and the refusal won the render - so an export that succeeded on the server was reported to
the person as an invalid link, with the link now genuinely spent.

Worth recording because of how it presented: the test passed in isolation and failed in the full
suite, purely because load changed which response landed last. The obvious reading was a flaky
test. Both token-consuming pages now record which token they have already acted on.

### What is still missing

- The widget's own form still does not post. A visitor's keystrokes stop at the Stage 6 typed seam,
  so the E2E submits to the real public endpoint directly. Wiring the seam is a small change that
  belongs with the runtime, not the inbox.
- No email or webhook is sent when a lead arrives (Stage 9), so the inbox is the only place a new
  lead shows up.
- The reconnect replay buffer is process-local; a client away longer than 50 events refetches.
- Analytics dashboards, delivery health, and the unsubscribe surface are Stages 10 and 11.
- The E2E database has never had migrations applied - `npm run migrate` against it fails on stale
  duplicate membership data from earlier runs. The suite passes because MongoDB creates collections
  implicitly, but that database is running without its unique indexes. Pre-existing, not introduced
  here, and it wants a deliberate reset rather than a silent drop.

---

## Part D-detail - Stage 9 delivery evidence

Stage 9 gives the outbox rows Stage 7 has been writing since March a consumer. Everything here is
strictly downstream of an already-committed submission.

### The two gate claims, each with named tests

```
npm test                    Test Files 13 passed (13)   Tests 291 passed (291)
npm run test:integration    Test Files 11 passed (11)   Tests 240 passed (240)
```

Fifty-three of the unit tests and thirty-one of the integration tests are new.

| Gate | Test                                                                 | What it proves                                                                                                                                                                                                                                                                   |
| ---- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `GATE 1: forced provider failures never fail a submission` (3 tests) | Five forced webhook failures in turn - 500, timeout, 400, blocked destination, connection reset - each against a real submission. Every one returns **202** and leaves a complete Contact and SubmissionEvent. Plus an email-provider failure and a broken enqueue, same result. |
| 2    | `GATE 2: retry classification` (4 tests)                             | A 400 fails permanently on attempt 1 and is never retried; a 429 retries; a 503 retries five times then dead-letters with five `transient_failure` history entries; a timeout is transient and a blocked destination is permanent.                                               |
| 2    | `GATE 2: idempotency` (3 tests)                                      | Re-running reconciliation twice creates no second delivery; two recipients of one submission are two distinct deliveries; an unverified external address is never sent to.                                                                                                       |
| 2    | `GATE 2: dead-letter and replay` (3 tests)                           | A dead letter is offered a replay, the replay succeeds when the receiver returns; a permanently failed row is refused a replay with **409** by the server, not merely hidden by the UI; the operator alert fires once per new dead letter.                                       |

### Provider matrix (blueprint 18.4)

Stated, not waited for. The webhook client is a port, so each outcome is scripted:

| Outcome                   | Classification | Result                                                         |
| ------------------------- | -------------- | -------------------------------------------------------------- |
| success 200               | -              | delivered on attempt 1                                         |
| 4xx (400)                 | permanent      | `failed`, 1 attempt, never retried                             |
| 429                       | **transient**  | retried - the one 4xx that means "not now" rather than "never" |
| 5xx (503)                 | transient      | 5 attempts, then `dead_letter`                                 |
| timeout                   | transient      | retried                                                        |
| blocked by SSRF check     | permanent      | `failed`, 1 attempt                                            |
| Brevo budget exhausted    | **neither**    | `delayed` until the next UTC window, `attempts` unchanged      |
| Redis enqueue unavailable | -              | submission still 202, outbox row survives for reconciliation   |

The budget row is the subtle one. Blueprint 5.3 says excess non-critical mail "remains queued until
the next provider allowance window", so a deferral is not a failure and must not consume one of the
five attempts - a test asserts `attempts` is still 0 after a deferral.

### Migration 008, applied and read back

```
npm run migrate     applied 1, skipped 7   (008_delivery)

deliveries
  workspace_type_status         { workspaceId, type, status, createdAt }
  workspace_created             { workspaceId, createdAt, _id }
  workspace_contact             { workspaceId, contactId, createdAt }
  uniq_workspace_idempotency_key{ workspaceId, idempotencyKey }   unique
  ttl_expires_at                { expiresAt }                     ttl 0s (90-day field)
webhook_endpoints
  workspace_widget              { workspaceId, widgetId }
  workspace_enabled             { workspaceId, enabled }
notification_recipients
  uniq_widget_recipient         { workspaceId, widgetId, normalizedEmail }  unique
outbox_events (added by 008)
  status_next_attempt           { status, nextAttemptAt }
  uniq_workspace_outbox_key     { workspaceId, idempotencyKey }   unique
```

Read back from the real database, `outbox_events` also carries a GLOBAL `uniq_idempotency_key` from
Stage 2. That makes the per-workspace one 008 adds redundant - the global constraint is strictly
stronger. It is recorded here rather than quietly dropped because the redundancy is real: keys are
`submission:<ObjectId>` and ObjectIds are globally unique, so neither index can fire before the
other, and removing an index from a shipped migration is a worse trade than carrying a spare.

`uniq_workspace_idempotency_key` on deliveries is what makes blueprint 12.2's "retries do not send
duplicate logical notifications" true even after a Redis flush. BullMQ deduplicates by job id inside
Redis, but Redis is a cache, and the reconciler deliberately re-enqueues work it believes was lost.

### Webhook security (blueprint 12.4)

- **SSRF**: every resolved address is checked, not just the first; IPv4-mapped IPv6
  (`::ffff:127.0.0.1`) is decomposed and re-checked; ports are restricted to 80/443/8080/8443 so a
  URL cannot probe an internal service; credentials in the URL are refused rather than stripped.
  Validated at save time AND immediately before every request, because DNS changes.
- **Redirects are disabled**, not revalidated. 12.4 permits either; disabling has no bypass, and a
  test confirms a 302 pointing at `169.254.169.254` is reported as an error rather than followed.
- **Signing**: HMAC-SHA256 over `timestamp.body`, not the body alone - a signature over the body is
  replayable forever. During a 24-hour rotation overlap BOTH signatures are sent, and a test
  verifies a real captured request against the old secret and the new one.
- **At rest**: the secret is AES-256-GCM encrypted with the existing master key, revealed exactly
  once, and a test asserts the plaintext appears neither in the stored document nor in any list
  response.

### No new capability names

`apps/server/src/domain/workspace/capabilities.ts` and the `Capability` union are **unchanged** -
`git diff` on both is empty. The delivery surface uses `delivery.view` (which the matrix already
marks `limited` for a Member) and `settings.delivery.write`.

### A defect only the full suite found

The page that completes a privacy request had no guard against its own effect firing twice, which
React does in development. The first call consumed the single-use token, the second was correctly
refused, and the refusal won the render - so an export that succeeded on the server was reported to
the person as an invalid link, with the link now genuinely spent.

Worth recording because of how it presented: the test passed in isolation and failed in the full
suite, purely because load changed which response landed last. The obvious reading was a flaky
test. Both token-consuming pages now record which token they have already acted on.

### What is still missing

- The remaining queue families from 12.1 - marketing opt-in, analytics aggregation, retention and
  purge, hourly sandbox reset - belong to Stages 10-12 and are absent rather than stubbed.
- The operator alert writes a structured `delivery.dead_letter_alert` log. A pager or email
  integration attaches at that call site; nothing external is notified today.
- Double opt-in is not the confirmation email this stage sends. Blueprint 12.1's "visitor
  confirmation email" is implemented; the opt-in state machine and unsubscribe are Stage 11.
- The reconciliation sweep runs every two minutes as a BullMQ job scheduler. It is registered only
  when workers are started in-process, which the tests deliberately do not do.
- Delivery rows expire after 90 days by TTL index, so the retention promise needs no sweep - but
  nothing yet purges the widget/contact trash those rows may reference (Stage 11).

---

## Part D-detail - Stage 10a analytics backend evidence

Stage 10 is split. **10a is ingestion, aggregation, retention, and the completed live stream; there
is no dashboard in it**, so Stage 10 stays OPEN until 10b renders them and proves live updates
through the browser.

### The three gate claims, each with named tests

```
npm test                    Test Files 14 passed (14)   Tests 317 passed (317)
npm run test:integration    Test Files 12 passed (12)   Tests 260 passed (260)
```

Twenty-six of the unit tests and twenty of the integration tests are new.

| Gate | Test                                                          | What it proves                                                                                                                                                                                                                                                                                                                    |
| ---- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `GATE 1: aggregation produces verified metrics` (4 tests)     | A deliberately shaped day - 4 impressions, 2 opens, 1 form start, 1 CTA click across 4 batches - aggregates to exactly those counters, sliced by domain and page, with `openEligible` true for a CTA popover and false for an inline form. Running the aggregation three times leaves ONE set of counters with unchanged numbers. |
| 2    | `GATE 2: raw-event expiry leaves aggregates intact` (3 tests) | Events aged past 90 days are deleted and the aggregate survives with its real counts. A day that reaches the cutoff with NO aggregate is aggregated first and only then deleted - asserted by checking the aggregate the sweep itself wrote carries the right numbers. Events inside the window are untouched.                    |
| 3    | `GATE 3: the completed live stream` (3 tests)                 | `usage.changed` and `delivery.status_changed` both reach their own workspace's stream and never the other tenant's open connection; a revoked member is refused on reconnect with 404.                                                                                                                                            |

### Why expiry is a sweep and not a TTL index

Blueprint 9.2 describes InteractionEvent as having "automatic expiry after 90 days", which reads
like a TTL index. It is not implemented as one, deliberately: 4.9 says raw events are "removed after
daily aggregates are produced", and a TTL index deletes on a clock alone and cannot check that
precondition. If aggregation had been failing for a week, a TTL would quietly destroy the only copy
of that week's data - turning a retention rule into data loss. The sweep aggregates first, verifies
the aggregate exists, and refuses the day otherwise.

### Privacy of the visitor pseudonym (blueprint 9.4, 21)

The construction is the Stage 7 IP pseudonym's, with two deliberate differences, and both are
tested:

- **Domain-separated.** Both pseudonyms derive from the same master secret and the same address, so
  without a distinct subkey label (`visitor-pseudonym:` vs `ip-pseudonym:`) they would be identical
  strings - and joining the analytics and abuse-evidence collections would reunite "who browsed"
  with "who was rate limited", exactly the linkage 9.4 exists to prevent.
- **Per widget.** Blueprint 21 asks for a "per-widget pseudonym" by name. Without the widget id
  inside the HMAC, one visitor would carry a single identifier across every customer site that
  embeds this platform - a cross-site tracking identifier by another name.

A test asserts the stored raw event contains no IP, no user agent, and a 64-hex pseudonym; another
asserts a client-supplied `visitorPseudonym` in the body is ignored.

### Migration 009, applied

```
npm run migrate     applied 1, skipped 8   (009_analytics)

interaction_events
  workspace_widget_date         { workspaceId, widgetId, occurredAt }
  workspace_day_widget          { workspaceId, localDay, widgetId }
  occurred_at                   { occurredAt }          -- the sweep, NOT a TTL
  workspace_day_visitor         { workspaceId, localDay, visitorPseudonym }
daily_analytics
  uniq_workspace_day_widget_dimension
                                { workspaceId, day, widgetId, dimension, dimensionValue }  unique
  workspace_day_dimension       { workspaceId, day, dimension }
```

The unique key is what makes aggregation idempotent: the job recomputes counters from the raw events
and upserts them, so a retried BullMQ job or an operator re-running a day produces the same numbers
rather than doubling them.

### An operational note on the E2E database

`npm run migrate` targets the development database only. `leadcapture_e2e` is separate and was still
at migration 007 when this stage's code assumed 009 - a browser run failed once at widget publish
with a server-side `MongoServerError`, and the test passed after the E2E database was brought up to
date (`applied 2, skipped 7`). The failure did not reproduce, so the causal link is not proven; the
staleness was. Stage 8b hit the same environment being behind in a different way. Nothing currently
enforces that a new migration reaches both databases, which is worth fixing before deployment.

### The monthly meters became real

Both were `null` - "not counted yet" - since Stage 4a. They now count against
`monthStartInZone(now, workspace.timezone)`, the same function the submission and interaction quotas
enforce with, so the meter and the gate can never disagree about when a month turned. A test in an
Auckland workspace confirms an event before that boundary is excluded.

### A defect only the full suite found

The page that completes a privacy request had no guard against its own effect firing twice, which
React does in development. The first call consumed the single-use token, the second was correctly
refused, and the refusal won the render - so an export that succeeded on the server was reported to
the person as an invalid link, with the link now genuinely spent.

Worth recording because of how it presented: the test passed in isolation and failed in the full
suite, purely because load changed which response landed last. The obvious reading was a flaky
test. Both token-consuming pages now record which token they have already acted on.

### What is still missing

- **Every dashboard.** 4.9 lists eight, and none of them exists yet - that is 10b, along with the
  browser proof of live updates. The aggregates and the funnel formulas are the typed seam it
  consumes.
- Geo slices are empty for interaction events. The country and city dimensions are computed and
  indexed, but the ingest path does not call a geo provider: 20,000 events a month per workspace
  would exhaust ip-api's free tier on telemetry alone, and blueprint 5.1 keeps that budget for the
  submission path. Country and city are populated from submissions today.
- The runtime records a `submission` funnel event where the form seam is, but the widget's form
  still does not post a real submission - so that particular counter reflects the visitor reaching
  the stage rather than an accepted lead.
- `status conversion` is implemented and unit-tested as a pure function; nothing computes its inputs
  from Contact status yet, which 10b will do when it renders the metric.
- The aggregation sweep runs hourly only when workers are started in-process; the tests call it
  directly, so nothing in CI proves the schedule fires.

---

---

## Part D-detail - Stage 10b analytics dashboard evidence

10b is the half a reader can see: the eight dashboards blueprint 4.9 names, the live updates riding
the stream 8a built, and the browser proof that closes Stage 10.

### The three gate claims, proven through the browser

```
node node_modules/@playwright/test/cli.js test analytics-journey analytics-accessibility
  11 passed (2.4m)
```

| Gate | Test                                                | What it proves                                                                                                                                                                                                                                                                                                                                                                                      |
| ---- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `GATE 1: seeded data produces verified metrics` (5) | A funnel shaped 4 seen / 2 opened / 1 started / 1 sent renders exactly those figures across all eight dashboards; a rate with no denominator renders as "no data" and the table contains no `0.0%`; a workspace with no traffic gets an empty state rather than a page of noughts; the range picker drives the whole page; a lead qualified through the real inbox appears in the status dashboard. |
| 2    | `GATE 2: cleanup leaves aggregates intact` (1)      | The figures rendered before a reload are the figures rendered after it, because the page reads the durable counters rather than the raw rows retention will retire.                                                                                                                                                                                                                                 |
| 3    | `GATE 3: live updates never cross tenants` (2)      | A submission moves this workspace's dashboard with nothing reloaded, while a second tenant's open dashboard stays empty; and after the connection is dropped and restored, a submission made by the other tenant mid-reconnect never appears here.                                                                                                                                                  |

The data is seeded through the real public event endpoint, so what the dashboard renders travelled
the Origin check, quota, rate limit, storage, and aggregation - it was never written straight into
the aggregate collection.

Three axe scans cover the page empty, populated with all eight dashboards, and with the day-by-day
disclosure open; a fourth test asserts the charts resolve as real tables by role, and a fifth drives
the range picker and the disclosure from the keyboard alone. Zero critical or serious violations.

Six new integration tests assert the read contract itself, which a browser cannot see: that a rate
with no denominator is `null` in the JSON and not `0`, that an unknown range is refused with 400,
that an anonymous caller gets 401, that two workspaces never see each other's figures, that widget
names are resolved at read time rather than frozen into the aggregate, and that today is counted
without waiting for the nightly roll-up.

### One endpoint for eight dashboards

`GET /api/v1/analytics` on `workspace.view`, the row of the section 11 matrix the workspace overview
already uses. **Stage 10b adds no capability names and does not touch the matrix.**

Eight requests would mean eight round trips, eight chances for the range to drift between them, and
a page that renders internally inconsistent totals while it loads. The dashboards are all slices of
one range of one workspace's data, so they are one read.

Widget names are resolved from the widget collection on each read rather than denormalised into the
aggregate. The counters are keyed by id and outlive the widget - 4.9 keeps aggregates after raw
events expire, and 9.5 keeps historical contacts after a widget is deleted - so a name frozen at
aggregation time would put one widget under two names in a single chart. There is a test.

### Freshness without recomputing

Blueprint 13.2 step 4 permits a dashboard read to "combine recent raw data for freshness". The read
aggregates today and yesterday before serving, which is bounded, idempotent by construction (the
counters are recomputed and upserted on a unique key), and needs no test-only API surface. Without
it a dashboard would be a day behind the traffic it reports, which is not a dashboard.

Every rate still comes from the server. The browser does not divide anywhere on this page.

### No charting library

Every shape these dashboards need is one of three - a daily series, a funnel, and a ranked list -
and all three are a handful of elements with a width. A library would cost 50-150 KB against budgets
8.3 enforces with tests, and would bring its own DOM, focus behaviour, ARIA, and colour opinions,
three of which would fight the design system and the WCAG 2.2 AA bar every other surface here meets.
The widget runtime bundle is unchanged at 15,120 B raw / 5,980 B gzip against the 20 KB / 8 KB
budgets - the charts live in the platform app, not the embed.

**The chart is the table.** The usual accessible chart ships a visually-hidden table beside the
picture, which is a second copy of the data that can drift from the first. Here the bar is drawn as
a background on the real table cell that already holds the number: one node carries both, a screen
reader gets an ordinary table, and there is nothing to keep in sync. The day-by-day series is the
one exception - its bars are `aria-hidden` decoration over a real table behind a native disclosure,
because a 90-row table should not be open by default.

### "No data" is never 0%

The single most important correctness rule on the page. A rate is `null` when its denominator is
zero, and `null` renders as an em dash with a screen-reader "No data" - never as 0%, which would
assert that people arrived and did not act.

The visual pass found the place where that rule is right and still reads as a bug: an inline contact
form is permanently visible, so it has no eligible impressions and its open rate is genuinely
undefined - but the dash sits beside a healthy count of opens, which looks broken. Where the cause
is structural the page now says it: "always visible, so there is no open step". Nothing is computed
to decide that; two counts the server already sent choose the sentence.

### What the visual pass changed

Screenshots of the populated, empty, and disclosure-open states, reviewed against the design brief:

- The delivery panel rendered four noughts where every other panel says in words that it has
  nothing. A grid of zeroes reads as a broken counter rather than a quiet week, particularly beside
  "Blocked and throttled", which does say so. It now has an empty state.
- The day-by-day disclosure had no affordance - a mono micro-label that looked like a stray caption
  rather than a control. It now carries a rotating marker.
- The status and abuse tables were both headed "Name". They now say "Status" and "Reason".
- The empty state claimed numbers "are rolled up once a day, so the most recent hour or two may not
  be here", which the on-read freshness above made untrue. Copy that lies about the system is worse
  than no copy.
- `WorkspaceHomePage`'s doc comment still said only the user meter was real, which Stage 10a made
  untrue. Corrected in place.

### A defect only the full suite found

The page that completes a privacy request had no guard against its own effect firing twice, which
React does in development. The first call consumed the single-use token, the second was correctly
refused, and the refusal won the render - so an export that succeeded on the server was reported to
the person as an invalid link, with the link now genuinely spent.

Worth recording because of how it presented: the test passed in isolation and failed in the full
suite, purely because load changed which response landed last. The obvious reading was a flaky
test. Both token-consuming pages now record which token they have already acted on.

### What is still missing

- **Country and city are empty for widget traffic.** The dimensions are computed, indexed, and
  rendered, but the ingest path deliberately does not call a geo provider for 20,000 events a month
  per workspace - blueprint 5.1 keeps that budget for the submission path. Both dashboards populate
  from submissions, so a workspace with views and no leads sees two empty panels. This is a stated
  product decision, not an unfinished one.
- **Delivery health here is a headline, not the operations view.** Four counters and a link to the
  Stage 9 delivery page, which is where replay and per-delivery detail live.
- **The hourly aggregation schedule is still unproven in CI.** The sweep runs when workers are
  started in-process; the tests call it directly. Unchanged from 10a.
- **No arbitrary date range in the UI.** The picker offers the three ranges 4.9 names, though the
  query schema already accepts an explicit `from`/`to` pair.

---

## Part D-detail - Stage 11 consent, privacy, and retention evidence

Stage 11 is the stage that makes earlier promises true. Every "recoverable for 30 days" this
product has shown a customer since Stage 4 was, until now, a stored date that nothing acted on.

### The exit gate, four claims and their named tests

```
node node_modules/vitest/vitest.mjs run --project unit-server privacy-domain
  Tests 30 passed (30)

node node_modules/vitest/vitest.mjs run --project integration-server privacy.integration
  Tests 31 passed (31)
```

| Gate | Test                                                                | What it proves                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `GATE 1: each 30-day window expires correctly, never early` (5)     | Contact trash, widget trash, workspace trash, and account deletion are each swept at day 30 and NOT at day 29, driven by an injected clock. A purged widget leaves its leads intact; a purged tenant takes every workspace-owned collection with it and touches no other tenant; a purged account keeps its audit trail with the actor anonymised. Account recovery works inside the window and is refused at 409 after it. |
| 2    | `GATE 2: purge is idempotent under a retry` (2)                     | A purge run four times does the work once - the second pass returns 0 and the record's `updatedAt` is unchanged, so a retry after a crash mid-sweep is not a second blanking. The whole sweep re-run reports zeroes.                                                                                                                                                                                                        |
| 3    | `GATE 3: unsubscribe suppresses marketing, never transactional` (7) | Confirm then unsubscribe, workspace-wide; no marketing send to a withdrawn contact; the visitor confirmation still delivered to that same suppressed address; a later ticked box does not undo the unsubscribe; a second click is `already` with exactly one suppression row; a token naming another workspace is refused; a tampered token is refused.                                                                     |
| 4    | `GATE 4: export and deletion need a valid token` (7)                | Refused with no token (400), an unissued token (404), a used token (404), and an expired one (404) - the expiry driven across the 24-hour boundary from both sides. An address that is not a lead gets a byte-identical answer and creates no record. An export returns one workspace's view only. A deletion erases the contact, blanks every submission value, and leaves only the suppression hash.                      |

Plus `the startup catch-up sweep` (2): a two-month clock jump is met by one bounded pass that
purges the backlog, a second pass that finds nothing, and a limit that does exactly what it says.

Thirty unit tests pin the pure rules underneath: the consent state machine's eleven transitions,
the wording fingerprint, the signed-link construction, the suppression key, and every window's
arithmetic to the millisecond either side of its deadline.

### Journey 8, through the browser

```
node node_modules/@playwright/test/cli.js test privacy-journey privacy-accessibility
  16 passed
```

Eleven journey tests and five axe scans. Every link is followed the way a person follows it - out
of an email captured in Mailpit, into a page with no session - rather than by constructing a URL
the test already knows the shape of. The token that arrives has to be one this server actually
minted and sent, which is the only reason to do this in a browser at all.

The scans cover the unsubscribe page in both outcomes, the confirmation page, the refused-link
state, the request form, its validation-error state, the "check your email" state, the full export,
and the settings panel with its warning showing. Zero critical or serious violations.

### Why suppression is a separate record, and a hash

Blueprint 4.8 permits "minimal suppression data" to remain after an email-verified deletion, so the
unsubscribe keeps being honoured. Two consequences follow, and both are load-bearing.

It cannot live on the Contact, because the Contact is what gets deleted. If it did, the next
submission from that address would create a fresh contact with no memory of the unsubscribe and
start mailing it again - precisely the failure the unsubscribe existed to prevent. There is a test
that deletes a contact, submits the same address again, and shows the new contact being refused.

And it cannot store the address, or "deletion" would leave the deleted person's email sitting in a
table. It is a workspace-salted HMAC of the normalized address, derived from the same master secret
as the two pseudonyms behind its own domain separator. It answers "is this address suppressed?" for
an address the asker already has, and cannot be read back into a mailing list. The per-workspace
salt matters too: identical keys across tenants would let two workspaces compare lists and discover
they share a lead.

### Two consent rules that are decisions, not mechanics

**A withdrawal outranks a later ticked box.** Somebody who unsubscribes and later fills in another
form with the marketing box ticked stays unsubscribed. A ticked checkbox is weak evidence - a
default, a mis-click, a form filled by somebody else - and a deliberate unsubscribe is strong
evidence. Letting the weak signal overturn the strong one would make an unsubscribe a temporary
inconvenience. They can opt in again, but only by confirming from the address itself.

**An unticked box is not a withdrawal.** Somebody who confirmed last month and files a support form
today without ticking a marketing box has not asked to be removed. Treating silence as withdrawal
would unsubscribe people who never asked to be.

### Why unsubscribe links are signed rather than stored

An unsubscribe link sits in every marketing email a contact has ever received, including ones from
a year ago, and it has to keep working - a dead unsubscribe link is the one thing an unsubscribe
must never be. A stored token would need an expiry to get wrong and a table that grows with send
volume. So the token carries its own claims and a MAC over them: `purpose:workspaceId:contactId`,
signed with a domain-separated subkey. Editing any part of it invalidates it, which is what stops
somebody swapping the contact id in their own link for a stranger's.

Replay is handled by the state machine rather than by consuming the token: a second click finds the
contact already withdrawn and says so, which is the right answer anyway - a person clicking twice
should be reassured, not shown an error.

The export and deletion flow does **not** use this. That one carries a stored, expiring, single-use
token, because it authorizes reading or destroying somebody's data rather than setting a boolean,
and 4.8 asks for verification of the same rigor as account email verification. It is that
construction reused verbatim: 32 random bytes, stored only as a SHA-256 hash, 24-hour expiry.

### Anonymised, not cascade-deleted

Blueprint 9.5 says a purged account has its "historical actor references anonymized". Not deleted:
an audit trail exists to record what happened in a workspace, and destroying it because its author
closed their account would hand anybody a way to erase their own history. So the record of the
action survives and the identity behind it is replaced with a reserved id, uniformly across audit
events, contact activities, assignments, revisions, and invitations - including the fields that are
not nullable, which is why a sentinel rather than `null`.

`ownerUserId` on a workspace is deliberately NOT in that list. It is not history, and a workspace
with an anonymous owner is one nobody can administer. That is also why deleting an account that
still owns an active workspace is refused with a 409 rather than quietly orphaning a tenant other
people are working in.

### Why the startup sweep exists, and what the schedule alone does not give you

Blueprint 9.5 asks for both a schedule and "bounded catch-up sweeps during startup", and the reason
is specific to how BullMQ schedules work. A job scheduler holds exactly ONE pending iteration and
re-arms from the moment it is upserted; it does not backfill. A process that slept through four
daily slots wakes to one late run rather than four, and an upsert during boot can move the next
slot past a deadline that has already passed. The schedule therefore guarantees "eventually"; only
a pass at startup guarantees "not skipped". Confirmed against the current BullMQ documentation
rather than assumed.

Every sweep is bounded and returns what it did, because after a long sleep the backlog is a batch
rather than a stream, and an unbounded delete is how waking up becomes an outage. Every sweep is
idempotent by construction rather than by a lock: a purge moves the record out of the state its own
query selects for, so a retry finds nothing to do.

### A gap this stage closed by accident

The in-process worker was never actually started outside the tests. `buildDependencies` has taken a
`startWorkers` flag since Stage 9, and `index.ts` never passed it - so the delivery retry schedule,
the outbox reconciler, and Stage 10a's analytics sweep existed but had never run in a deployed
process, and Stage 11's startup catch-up would have been dead code for the same reason. Blueprint
12.1 is explicit that "the worker starts inside the same Render process as the web server". Fixed
here; the tests still start without workers so a delivery outcome stays a stated fact rather than a
race with a poller.

### A defect only the full suite found

The page that completes a privacy request had no guard against its own effect firing twice, which
React does in development. The first call consumed the single-use token, the second was correctly
refused, and the refusal won the render - so an export that succeeded on the server was reported to
the person as an invalid link, with the link now genuinely spent.

Worth recording because of how it presented: the test passed in isolation and failed in the full
suite, purely because load changed which response landed last. The obvious reading was a flaky
test. Both token-consuming pages now record which token they have already acted on.

### What is still missing

- **The public policy pages** - privacy policy, terms, cookie notice, acceptable-use - are Stage 12.
  This stage built the mechanisms those documents will describe.
- **No UI for account deletion or recovery.** The API exists and is tested; the account page does
  not offer it yet. A person can delete their account with an API call and not through a button.
- **The suppression list has no operator view.** A workspace cannot see who has unsubscribed, which
  is correct on the privacy side - the entries are hashes and cannot be listed back into addresses -
  but it means a support question about a specific address has to be answered by asking that
  address to try the form again.
- **A marketing opt-in email lost to a Redis outage is not recovered by an outbox row**, unlike a
  submission's side effects. The contact stays `pending` and is asked again on their next
  submission, which is the safe direction to fail in, but it is a weaker guarantee than the
  delivery families have.
- **Nothing proves the daily schedule fires on a real sleeping instance.** The sweep is driven
  directly by the tests and the catch-up is proven against a clock jump; the Render behaviour it is
  designed for cannot be observed until Stage 14.

## Change log

| Date       | Stage | Change                                                                                                                                                               |
| ---------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-27 | 0     | File created. All entries recorded as not-yet-implemented with their planned stages. No proofs claimed.                                                              |
| 2026-08-28 | 1     | D14, D16, D17, and C18 moved to `IN PROGRESS` with real executed evidence in Part D-detail. All six acceptance probes and every product requirement remain unproven. |

| 2026-08-28 | 2 | D1, D13, and C6 moved to `PROVEN` for the foundation repositories, evidenced by 25 integration tests against a real MongoDB replica set. D2, C2, C19, B1, and the logging baseline moved to `IN PROGRESS` with their gaps stated. All six acceptance probes remain unproven. |

| 2026-08-28 | 3a | C1, C4, and C5 moved to `PROVEN`; B2 and C2 to `IN PROGRESS` with the MFA gap stated explicitly. Evidenced by 34 auth integration tests against real MongoDB, Redis, and Mailpit plus 23 auth unit tests. MFA, auth UI, and browser E2E are Stage 3b and are NOT claimed. All six acceptance probes remain unproven. |

| 2026-08-28 | 3b | Blueprint Stage 3 COMPLETE. B2, C3, and C12 moved to `PROVEN`; C2 completed for auth tokens; C13 and D15 moved to `IN PROGRESS`. Evidenced by 17 browser E2E tests, 74 integration tests, 82 unit tests, and axe checks reporting zero critical or serious violations on every auth page. All six acceptance probes remain unproven. |

| 2026-08-28 | 4a | B1, C6, and C7 moved to `PROVEN` at the API level; D2 widened onto the new workspace write paths. Evidenced by 32 workspace integration tests against real MongoDB, Redis, and Mailpit, plus 43 unit tests asserting every cell of the section 11 matrix against an independently transcribed copy. Blueprint Stage 4 is NOT complete: the workspace UI and its browser E2E are Stage 4b. All six acceptance probes remain unproven. |

| 2026-08-28 | 4b | Blueprint Stage 4 COMPLETE. B1 moved to `PROVEN` end to end and C7 strengthened: the UI hides controls using capabilities the SERVER derives from the section 11 table, so there is no second copy of the policy. D2 widened onto workspace recovery. Evidenced by 37 browser E2E tests (20 new), 110 integration tests (4 new), and 125 unit tests, with axe reporting zero critical or serious violations on every new page including error and empty states. All six acceptance probes remain unproven. |

| 2026-08-29 | 5a | B3, B4, B5, and B10 moved to `IN PROGRESS` with their API halves proven; `usage().activeWidgets` changed from a hard-coded null to a real count, and the Stage 4a test asserting null was updated to match. Evidenced by 37 new unit tests and 21 new integration tests against real MongoDB, Redis, and Mailpit, plus migration `005_widget` applied and its indexes read back from a real database. No capability name was added: the three widget rows of the section 11 matrix already existed. Blueprint Stage 5 is NOT complete - the builder UI, live preview, and browser E2E are Stage 5b. All six acceptance probes remain unproven. |

| 2026-08-29 | 5b | Blueprint Stage 5 COMPLETE. B3 and B5 moved to `PROVEN`, now through the browser as well as the API. The per-type mandatory-field rule was moved into `@lcp/contracts` so the builder and the API validator share one implementation. Evidenced by 20 new browser tests (57 in the suite), with axe reporting zero critical or serious violations on every new page including error, empty, and mid-confirmation states - one of which caught a real contrast defect in the live preview. All six acceptance probes remain unproven. |

| 2026-08-29 | 6 | Blueprint Stage 6 COMPLETE. D3, D5, and D6 moved to `PROVEN` and D4 to `IN PROGRESS`; B4's runtime half is now executed rather than stored. Evidenced by 15 new browser tests against the real second origin, 15 new integration tests for the public endpoint, and 21 new unit tests for trigger, cooldown, and identity decisions. Bundle sizes measured and tracked: runtime 13,613 B raw / 5,439 B gzip, loader 734 B / 434 B gzip, with no framework or validation library in the public bundle. All six acceptance probes remain unproven; every one needs the Stage 7 submission endpoint. |

| 2026-08-29 | 7 | Blueprint Stage 7 COMPLETE. **All six acceptance probes (A1-A6) moved to `PROVEN`**, each with its own named integration test and a re-runnable command. A1's dashboard half and A5's real queue behaviour are noted in place as Stage 8 and Stage 9 work. Evidenced by 21 new unit tests and 25 new integration tests against real MongoDB, Redis, and Mailpit, plus migration `006_submissions` applied and its indexes read back. Geo providers are exercised deterministically through a port; the real services are never called by the suite. |
| 2026-08-29 | 8a | Blueprint Stage 8, sub-stage 8a. Contact inbox BACKEND: search/filter/cursor-paginated list, detail and timeline, workflow writes, canonical edits under optimistic concurrency, merge, bulk actions, 30-day trash, streaming filtered export, and the authenticated workspace-scoped SSE stream. Evidenced by 34 new unit tests and 38 new integration tests against real MongoDB, Redis, and Mailpit, plus migration `007_contact_inbox` applied, re-run as a no-op, and its indexes read back. **No new capability names and no matrix edits**; the section 11 table is unchanged. Stage 8 itself stays OPEN pending 8b (inbox UI, timeline, bulk-action UI, browser E2E). |
| 2026-08-29 | 8b | Blueprint **Stage 8 COMPLETE**. Contact inbox UI: search, the full filter set behind a disclosure, keyset pagination, deterministic sort, bulk selection with a capability-driven action bar, inline merge, canonical editing with a designed conflict state, the lead timeline, the trash, streaming export, and live arrival over SSE. Evidenced by 16 new browser tests (88 total), including 6 axe scans covering the empty, no-results, conflict, and trash states plus a keyboard-only pass. The browser found a real defect review missed: export was hidden inside the collapsed filter panel. |
| 2026-08-29 | 9 | Blueprint **Stage 9 COMPLETE**. BullMQ queue families, outbox reconciliation, five-attempt exponential backoff with jitter, transient-only retry, dead-letter and manual replay, per-widget verified recipients, controlled email templates, SSRF-safe HMAC-signed webhooks with 24-hour rotation overlap, and the workspace delivery health view. Evidenced by 53 new unit tests and 31 new integration tests, including the full 18.4 provider matrix. **No new capability names**; the section 11 table is unchanged. The E2E database was reset with the user's explicit authorization, closing the migration gap Stage 8b recorded: `applied 7, skipped 0`. |
| 2026-08-29 | 10a | Blueprint Stage 10, sub-stage 10a. Analytics BACKEND: the public interaction-event endpoint with Origin/quota/rate hardening and a per-widget rotating visitor pseudonym, runtime funnel instrumentation, idempotent daily aggregation, a 90-day retention sweep that never deletes an un-aggregated day, the five funnel formulas as pure functions, and the remaining two SSE event types. Both monthly meters became real, on the workspace timezone boundary. Evidenced by 26 new unit tests and 20 new integration tests. Stage 10 stays OPEN pending 10b (dashboards + browser E2E). |
| 2026-08-30 | 10b | Blueprint **Stage 10 COMPLETE**. B9 moved to `PROVEN` and B10 to `PROVEN` for all four meters. The eight dashboards of 4.9 on one page, from a single authenticated `workspace.view` read; a rate with no denominator renders as "no data" and, where the cause is structural, says why; live updates ride the 8a stream with no second connection; reads combine today with the stored aggregates per 13.2 step 4. Evidenced by 11 new browser tests (101 total) including 3 axe scans and a keyboard-only pass, and 6 new integration tests (266 total) for the read contract a browser cannot see. **No new capability names**; the section 11 table is unchanged. No charting library was added and the widget runtime bundle is unchanged. The visual pass found five real defects, including an empty state that claimed a freshness delay this stage had removed. |
| 2026-08-30 | 11 | Blueprint **Stage 11 COMPLETE**. B8 moved to `PROVEN` except its policy pages (Stage 12); D20 to `IN PROGRESS`. Consent state machine with single/double opt-in and immutable evidence; workspace-wide suppression that outlives the contact as a salted hash; email-verified export and deletion on the account-verification token construction; workspace-configurable retention measured from a deliberate anchor; and all four 30-day windows of the 9.5 table actually firing, with actor references anonymised rather than cascade-deleted and a bounded startup catch-up sweep. Account deletion and recovery, which had no route before. Evidenced by 30 new unit tests (347 total), 31 new integration tests (297 total), and 16 new browser tests (117 total) including 5 axe scans. **No new capability names**; the section 11 table is unchanged. Migration `010_privacy` applied. Found and fixed a Stage 9 gap: the in-process worker was never started outside the tests, so every schedule since then had never run in a deployed process. |

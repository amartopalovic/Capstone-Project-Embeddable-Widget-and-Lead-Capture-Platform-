# Stage checklist

The project is implemented in 16 bounded stages (blueprint §19). Exactly one stage is requested per
implementation prompt, and work stops when that stage's exit gate is green.

**Progress: 10 of 16 stages complete.**

## Stage execution rules (blueprint §19)

Every implementation prompt must: name exactly one stage; require the implementer to read the
blueprint and inspect the current repository before changing files; preserve unrelated user changes
and all previously completed stage gates; prohibit features from later stages unless a small
interface stub is essential; require tests and documentation appropriate to that stage; update
`EVIDENCE.md` and `BUILDLOG.md` as work is performed; and finish with changed files, commands run,
test results, remaining limitations, and confirmation of the exit gate.

---

- [x] **Stage 0 — Repository contract and design pack**
  - **Goal:** Establish the public repository, project rules, and evaluator-visible design before
    feature code.
  - **Exit gate:** A stranger can understand the problem, planned request paths, data ownership,
    run/test commands that will exist, and deliberate limitations.
  - _Completed 2026-08-27. Documentation and repository scaffolding only; no application code._

- [x] **Stage 1 — Workspace tooling, local infrastructure, and CI baseline**
  - **Goal:** Make the multi-workspace TypeScript project install, build, test, and run predictably.
  - **Exit gate:** One documented local command starts dependencies and empty apps; CI installs,
    type-checks, tests a smoke case, and builds all workspaces.
  - _Completed 2026-08-28. `docker compose up --build` starts all six services; `npm run lint`,
    `typecheck`, `test`, and `build` all pass across nine workspaces. CI workflow is committed but
    has not yet run on GitHub, because no remote is configured._

- [x] **Stage 2 — Shared contracts, persistence, migrations, and tenancy foundation**
  - **Goal:** Establish the data and application boundaries that every feature will reuse.
  - **Exit gate:** Two seeded tenants cannot access each other's records through any foundation
    repository; indexes and migrations are repeatable on a clean database.
  - _Completed 2026-08-28. 25 integration tests against a real MongoDB replica set prove
    cross-tenant isolation in both directions for every foundation repository, and prove migrations
    are repeatable (a second run applies nothing and leaves the index state identical) and
    idempotent even with the ledger wiped. 36 unit tests cover the shared contracts, log redaction,
    and the Redis key policy._

- [x] **Stage 3 — Authentication and account security** _(delivered as 3a + 3b)_
  - **Goal:** Deliver secure public account creation and session management.
  - **Exit gate:** Auth integration and E2E tests prove verification gates, session expiry and
    revocation, MFA, generic responses, and no credential leakage.
  - _Completed 2026-08-28. All five gate clauses are proven: 74 integration tests against real
    MongoDB, Redis, and Mailpit, plus 17 browser E2E tests driving the real UI, plus 82 unit tests.
    Automated axe checks report zero critical or serious violations on every auth page._
  - [x] **Stage 3a — Credential backend, Redis sessions, transactional email** _(2026-08-28)_
    - Registration, verification, login/logout, password reset, Argon2id with policy and breach
      blocking, Redis sessions with 7-day idle and 30-day absolute lifetimes, CSRF, session/device
      listing and revocation (API), per-flow throttles, audit events, and Brevo/Mailpit adapters
      with the section 5.3 budget reserve.
  - [x] **Stage 3b — TOTP MFA, accessible auth UI, browser E2E** _(2026-08-28)_
    - Two-phase TOTP enrollment with an AES-256-GCM encrypted secret and hashed single-use recovery
      codes; a login challenge that issues no session until the second factor is satisfied; replay
      protection on the accepted TOTP counter; session rotation on every MFA change; eight
      accessible React pages; and a Playwright + axe suite.

- [x] **Stage 4 — Workspace onboarding, switcher, RBAC, and invitations** _(delivered as 4a + 4b, 2026-08-28)_
  - **Goal:** Complete the multi-workspace user model.
  - **Exit gate:** Role matrix and cross-tenant tests pass from API through browser; unverified
    users cannot invite or publish. **Met.** The matrix is proven at both levels: 110 integration
    tests over HTTP, and 20 browser tests that assert a Member is never shown an invite, role,
    transfer, or delete control, that an Admin is offered Member but never Admin, and that an
    unverified Owner is refused an invite with `email_not_verified` rather than a bare forbidden.
  - [x] **Stage 4a — Onboarding, workspace context, RBAC policy, invitations backend** _(2026-08-28)_
    - Onboarding with name and IANA timezone and the one-owned-workspace limit; session-derived
      workspace context and a switcher that verifies membership; a policy engine covering the whole
      §11 matrix; invitation send/accept/revoke including the register-then-verify path for a
      brand-new recipient; ownership transfer to a verified Admin; workspace soft-delete and
      recovery; the account-deletion precondition; workspace-scoped audit; and the usage meter.
    - Proven by 32 integration tests against real MongoDB, Redis, and Mailpit, plus 43 unit tests
      that assert every cell of the §11 matrix against an independently transcribed copy of it.
      No UI, no browser E2E.
  - [x] **Stage 4b — Workspace UI (onboarding, switcher, members, invitations, settings) and browser E2E** _(2026-08-28)_
    - Onboarding with a detected, editable timezone; a `details`-based workspace switcher; a
      members and invitations page whose controls are driven by capabilities the SERVER derives
      from the §11 matrix; an invitation-acceptance page covering every outcome the API returns;
      a workspace-scoped audit log; settings with ownership transfer and a soft-delete danger
      zone; honest usage meters that show unmeasured quotas as unmeasured rather than as zero;
      and a minimal shell to host them.
    - Proven by 20 new Playwright tests (37 in the suite) against the real Compose stack, with
      `axe` WCAG 2.2 AA scans on every new page including error and empty states.
    - Closed one gap left by 4a: a soft-deleted workspace was undiscoverable, so recovery had no
      reachable entry point. Added `GET /workspaces/recoverable`.

- [x] **Stage 5 — Widget domain model, builder, drafts, and publishing** _(delivered as 5a + 5b, 2026-08-29)_
  - **Goal:** Let teams configure the three widget types safely.
  - **Exit gate:** A Member edits a draft without changing live state; a verified Admin publishes;
    another tenant cannot read, modify, or publish it.

  - **Exit gate met.** A Member edits a draft without changing live state, a verified Admin
    publishes, and another tenant cannot read, modify, or publish it - each proven at the API
    level in 5a and again through the browser in 5b.
  - [x] **Stage 5a — Widget domain model, persistence, publishing lifecycle, and API** _(2026-08-29)_
    - `Widget` and `WidgetRevision` records with a platform-unique opaque public id, workspace +
      status indexing, 30-day widget trash, revision numbers unique per workspace + widget, and a
      partial unique index allowing at most one draft per widget.
    - The three locked widget types, the seven predefined field types with per-type mandatory-field
      rules, and a closed appearance vocabulary with no free-form CSS, HTML, or script anywhere.
    - Pure, independently unit-tested domain rules for host/wildcard matching, safe-glob page
      include/exclude matching, and CTA/redirect destination validation.
    - Draft/publish lifecycle with optimistic concurrency (409 `stale_revision` on a stale write),
      immutable published revisions, unpublish, soft-delete and recovery, and the embed snippet.
    - The 10-active-widget cap, and `usage().activeWidgets` changed from a hard-coded null to a
      real count.
    - Proven by 37 unit tests and 21 integration tests against real MongoDB, Redis, and Mailpit.
      No React builder, no live preview, no browser E2E.
  - [x] **Stage 5b — React settings-form builder, live preview, embed-snippet UI, and browser E2E** _(2026-08-29)_
    - A widget list with create and trash/recover; a two-pane builder with the settings form beside
      a live preview that renders the draft as it is edited; field add/remove/reorder honouring the
      locked mandatory fields; appearance, trigger, targeting, cooldown, and success/redirect
      settings; publish/unpublish and delete gated by the capabilities the API derives; a
      non-destructive draft-conflict flow; and the embed snippet with copy-to-clipboard.
    - Proven by 20 new Playwright tests (57 in the suite) against the real Compose stack, with
      `axe` WCAG 2.2 AA scans on every new page including error, empty, and mid-confirmation
      states.
    - Moved the per-type mandatory-field rule into `@lcp/contracts` so the builder and the API
      validator share ONE implementation rather than two that could drift.

- [x] **Stage 6 — Cached public loader and framework-free widget runtime** _(2026-08-29)_
  - **Goal:** Render published widgets correctly on an origin the platform does not control.
  - **Exit gate:** All three widget types render on the second origin, multiple instances coexist,
    host CSS does not break them, and cache headers match the contract. **Met**, each by a named
    Playwright test running against `apps/demo` on port 5174 while the platform runs on 5173.
  - A public config endpoint returning renderable settings only, with the Origin allowlist,
    published state, and workspace state all re-checked on the server; a generated stable loader
    with a 5-minute cache; a content-hashed runtime served immutable for a year; Shadow DOM
    rendering of all three widget types in inline, modal, and floating modes; a page-level
    registry sharing one runtime across many tags; and live click, delay, scroll-depth, and
    exit-intent triggers with session or multi-day cooldown and a rotating pseudonymous
    visitor identifier.
  - The pure rules from Stage 5a moved into `@lcp/contracts` so the runtime uses the SAME
    implementation the server validates with, rather than a copy.
  - Measured bundle sizes, tracked in CI and asserted by the unit suite: runtime 13,613 B raw /
    5,439 B gzip, loader 734 B raw / 434 B gzip. No framework and no validation library reach
    the public bundle.

- [x] **Stage 7 — Hardened public submission path** _(2026-08-29)_
  - **Goal:** Satisfy the capstone's most important backend request path.
  - **Exit gate:** All six acceptance probes for the submission path pass locally, including
    provider and side-effect failure simulations.

  - **All six PDF acceptance probes now pass locally**, each with its own named, re-runnable
    integration test: valid second-origin submission, malformed/oversized input, burst traffic,
    geo fallback, side-effect failure, and honeypot.
  - The request gate follows blueprint 7.3's eleven numbered rules in order: Origin allowlist and
    published-state checks, 32 KB / 20-field / 5,000-character limits, three Redis rate limits,
    validation against the server-owned field schema, 24-hour idempotency, honeypot and timing
    heuristics, the monthly quota on workspace-timezone boundaries, geo with fallback, then one
    transaction covering contact upsert, immutable submission event, consent evidence, and a
    durable outbox record.
  - Raw IP is never persisted: a monthly-rotating HMAC pseudonym is what abuse evidence keeps.
  - Origin and domain matching are reused from `@lcp/contracts`, not reimplemented.

- [x] **Stage 8 — Contact inbox, collaboration, lifecycle, and exports** _(2026-08-29)_
  - **Goal:** Turn accepted submissions into a usable collaborative lead workspace.
  - **Exit gate:** Role-aware E2E journeys pass; export matches active filters; live arrival is
    workspace-isolated.
  - [x] **8a — Inbox backend: search, lifecycle, merge, export, SSE** _(2026-08-29)_
    - Search across names, emails, and captured submission values; filters for status, date,
      widget, domain, page URL, assignee, tag, country, and city; deterministic sorting and
      keyset cursor pagination.
    - Canonical edits under optimistic concurrency, so neither a teammate nor a later submission
      can silently overwrite one; merge that re-links events, activities, and consent evidence and
      retires the duplicate with an audit trail.
    - Bulk actions resolved through the section 11 matrix rather than a second role table, 30-day
      contact trash with recovery, and a streaming CSV/JSON export that matches the caller's active
      filter exactly.
    - One authenticated workspace-scoped SSE stream over Redis pub/sub, with heartbeats,
      server-set reconnect backoff, a last-event cursor, and membership rechecked at connect and
      on every heartbeat.
    - **No new capability names and no matrix edits**; `capabilities.ts` is unchanged.
  - [x] **8b — Inbox UI, timeline, bulk actions, and browser E2E** _(2026-08-29)_
    - The inbox list with search, the nine-dimension filter set, keyset pagination, deterministic
      sort, bulk selection, and a live-arrival button that queues new leads rather than injecting
      rows into a list somebody is reading.
    - The lead detail page: workflow controls for every role, canonical editing for Owner/Admin
      with a designed conflict state rather than a bare error, and a timeline that gives immutable
      submissions and team activity two different visual weights.
    - Inline merge, the 30-day trash with recovery, and a streaming export whose link is built from
      the same query string the list just ran.
    - **No role table in the UI**: every affordance reads a capability the server derived.
    - 16 new browser tests, including 6 axe scans (WCAG 2.2 AA) over the empty, no-results,
      conflict, and trash states, and a keyboard-only pass.

- [x] **Stage 9 — Reliable email, webhooks, and delivery operations** _(2026-08-29)_
  - BullMQ queue families for the four side effects this stage owns, with the outbox reconciler
    that recovers work whose enqueue never happened.
  - Transient-only retry: five attempts with exponential backoff and jitter, a permanent failure
    stopped on its first attempt by `UnrecoverableError`, a dead-letter state, an operator alert
    that fires once per new failure, and Owner/Admin manual replay.
  - Per-widget recipients with separate verification for external addresses, and controlled email
    templates whose variables are allowlisted and whose HTML is refused.
  - SSRF-safe webhooks: every resolved address checked, redirects disabled, ports restricted,
    HMAC-SHA256 signing over `timestamp.body`, and a 24-hour dual-secret rotation overlap.
  - The workspace delivery health view, with the Brevo daily allowance shown as the structured
    budget it actually is.
  - **No new capability names**; `capabilities.ts` is unchanged.
  - **Goal:** Complete failure-safe side effects without weakening the submission path.
  - **Exit gate:** Forced provider failures never fail a submission; retry classification,
    idempotency, dead-letter, and replay tests pass.

- [ ] **Stage 10 — Funnel events, analytics aggregation, and complete live updates**
  - **Goal:** Deliver the selected analytics without over-retaining visitor data.
  - **Exit gate:** Seeded deterministic data produces verified metrics; raw-event cleanup leaves
    aggregates intact; reconnecting SSE does not cross tenants.
  - [x] **10a — Ingestion, aggregation, and the completed live-update backend** _(2026-08-29)_
    - The public interaction-event endpoint, hardened like the Stage 7 submission path: Origin
      allowlist, published-state check, 8 KB body, batch schema, per-visitor and per-widget rate
      limits, and the 20,000/month workspace quota on the workspace's own timezone boundary.
    - A rotating visitor pseudonym that is domain-separated from the IP pseudonym and scoped per
      widget, so it is neither joinable with abuse evidence nor usable across customer sites.
    - Runtime funnel instrumentation for all five events, batched and best-effort, flushed with
      `sendBeacon` when the page goes away.
    - Idempotent daily aggregation into workspace/widget/day/dimension counters, and a 90-day
      retention sweep that aggregates a day before it will delete it - never a TTL index.
    - The five funnel formulas as pure functions, with `null` rather than `0` for a zero
      denominator, ready for 10b to consume.
    - `usage.changed` and `delivery.status_changed` added to the Stage 8a stream, completing 13.1.
  - [ ] **10b — Dashboards and browser E2E** _(not started)_

- [ ] **Stage 11 — Consent, unsubscribe, privacy, and retention automation**
  - **Goal:** Complete the data-rights and deletion promises.
  - **Exit gate:** Time-controlled tests prove every recovery window, permanent purge, suppression
    rule, and privacy verification boundary.

- [ ] **Stage 12 — Public site, documentation, policies, and anonymous demo**
  - **Goal:** Make the product understandable and evaluable without assistance.
  - **Exit gate:** A new visitor can understand the product, run the demo, find the API and embed
    docs, and never mistake the portfolio deployment for an SLA-backed service.

- [ ] **Stage 13 — Security, accessibility, resilience, and observability hardening**
  - **Goal:** Verify cross-cutting requirements before deployment rather than treating them as
    polish.
  - **Exit gate:** The security checklist is evidenced, critical accessibility violations are zero,
    and degraded optional providers do not break primary requests.

- [ ] **Stage 14 — Production-demo deployment and recovery rehearsal**
  - **Goal:** Deploy the exact tested architecture to the selected free providers.
  - **Exit gate:** Clean deployment from main passes smoke, cross-origin, auth, queue, and restore
    checks without a credit card.

- [ ] **Stage 15 — Evaluation evidence and portfolio release**
  - **Goal:** Finish the submission pack and recruiter-facing story.
  - **Exit gate:** A clean-machine evaluator can start the system with the documented command, seed
    it, run tests, execute probes, and verify each claim in minutes.

---

## Crosswalk to the capstone brief's phases (blueprint §20)

| Brief phase                              | Implementation stages                                   |
| ---------------------------------------- | ------------------------------------------------------- |
| Phase 1 — Design                         | Stages 0–2                                              |
| Phase 2 — Hardened submission path       | Stages 3–7, with side-effect proof completed in Stage 9 |
| Phase 3 — Delivery, dashboard, and proof | Stages 6 and 8–15                                       |

The expanded sequence is longer because this project includes a complete React product,
collaborative workspaces, consent and privacy workflows, real-time analytics, and public
deployment. The original acceptance probes remain mandatory gates and are never deferred behind
optional polish.

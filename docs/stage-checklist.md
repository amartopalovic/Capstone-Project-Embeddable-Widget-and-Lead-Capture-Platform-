# Stage checklist

The project is implemented in 16 bounded stages (blueprint §19). Exactly one stage is requested per
implementation prompt, and work stops when that stage's exit gate is green.

**Progress: 2 of 16 stages complete.**

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

- [ ] **Stage 2 — Shared contracts, persistence, migrations, and tenancy foundation**
  - **Goal:** Establish the data and application boundaries that every feature will reuse.
  - **Exit gate:** Two seeded tenants cannot access each other's records through any foundation
    repository; indexes and migrations are repeatable on a clean database.

- [ ] **Stage 3 — Authentication and account security**
  - **Goal:** Deliver secure public account creation and session management.
  - **Exit gate:** Auth integration and E2E tests prove verification gates, session expiry and
    revocation, MFA, generic responses, and no credential leakage.

- [ ] **Stage 4 — Workspace onboarding, switcher, RBAC, and invitations**
  - **Goal:** Complete the multi-workspace user model.
  - **Exit gate:** Role matrix and cross-tenant tests pass from API through browser; unverified
    users cannot invite or publish.

- [ ] **Stage 5 — Widget domain model, builder, drafts, and publishing**
  - **Goal:** Let teams configure the three widget types safely.
  - **Exit gate:** A Member edits a draft without changing live state; a verified Admin publishes;
    another tenant cannot read, modify, or publish it.

- [ ] **Stage 6 — Cached public loader and framework-free widget runtime**
  - **Goal:** Render published widgets correctly on an origin the platform does not control.
  - **Exit gate:** All three widget types render on the second origin, multiple instances coexist,
    host CSS does not break them, and cache headers match the contract.

- [ ] **Stage 7 — Hardened public submission path**
  - **Goal:** Satisfy the capstone's most important backend request path.
  - **Exit gate:** All six acceptance probes for the submission path pass locally, including
    provider and side-effect failure simulations.

- [ ] **Stage 8 — Contact inbox, collaboration, lifecycle, and exports**
  - **Goal:** Turn accepted submissions into a usable collaborative lead workspace.
  - **Exit gate:** Role-aware E2E journeys pass; export matches active filters; live arrival is
    workspace-isolated.

- [ ] **Stage 9 — Reliable email, webhooks, and delivery operations**
  - **Goal:** Complete failure-safe side effects without weakening the submission path.
  - **Exit gate:** Forced provider failures never fail a submission; retry classification,
    idempotency, dead-letter, and replay tests pass.

- [ ] **Stage 10 — Funnel events, analytics aggregation, and complete live updates**
  - **Goal:** Deliver the selected analytics without over-retaining visitor data.
  - **Exit gate:** Seeded deterministic data produces verified metrics; raw-event cleanup leaves
    aggregates intact; reconnecting SSE does not cross tenants.

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

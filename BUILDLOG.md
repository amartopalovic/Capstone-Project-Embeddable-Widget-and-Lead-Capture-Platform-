# BUILDLOG

An honest record of where AI assistance helped, where it failed or had to be corrected, and what
judgment calls were made. Required by blueprint §15.4.

## Format

Each stage gets one entry with these headings:

- **What was done** — the concrete output of the session.
- **Where AI helped** — work the assistant genuinely accelerated.
- **Where AI failed or was corrected** — mistakes, wrong turns, and rework. Recorded even when
  minor. An entry with nothing in this section should be treated as suspicious rather than
  impressive.
- **Judgment calls** — decisions the source material did not settle, and the reasoning used.
- **Open questions** — things a human should confirm.

---

## Stage 0 — Repository contract and design pack (2026-08-27)

**Assistant:** Claude Opus 5, via Claude Code.
**Scope authorized:** Stage 0 only — repository and documentation scaffolding. No application code,
no tooling, no dependencies, no CI, no deployment.

### What was done

Inspected the working folder (it contained only
`Embeddable_Widget_Lead_Capture_Blueprint.md`, 61,559 bytes, matching expectations), read the
blueprint in full, verified the three required Claude Code plugins, then created:

- `README.md` — mission, architecture summary with both blueprint Mermaid diagrams, the three
  request paths, data ownership, planned repository layout, the monorepo caveat, non-goals, and
  clearly-marked placeholder sections for run/seed steps, deployment links, limitations, and
  evidence.
- `LICENSE` — MIT, per blueprint §15.4.
- `.gitignore` — Node/TypeScript monorepo rules, deliberately written before any dependency or
  secret could be committed. Ignores `.env` and `.env.*` but explicitly un-ignores `.env.example`.
- `.env.example` — placeholder labels only for the configuration categories the blueprint
  anticipates, each annotated with the stage that first consumes it.
- `capstone.yaml` — machine-readable manifest skeleton with `TBD` values and a `filled_in_by` stage
  note on every field.
- `EVIDENCE.md` — the six acceptance probes from §18.5, the locked product decisions from §4, the
  security checklist from §17, cross-cutting proofs from §7–§16, and the twelve definition-of-done
  conditions from §22. Every entry marked not-yet-implemented with its planned stage.
- `BUILDLOG.md` — this file.
- `docs/architecture-summary.md` — the one-page evaluator design document.
- `docs/repository-layout.md` — the conceptual workspace ownership map.
- `docs/stage-checklist.md` — all 16 stages with goal and exit gate, Stage 0 checked.

Then initialized git and made the initial commit locally. Nothing was pushed, and no remote was
configured.

### Where AI helped

- Reading the 1,274-line blueprint end to end and reorganizing it into an orientation document
  aimed at a stranger, without contradicting the source. Most of the value here was selection and
  ordering, not writing.
- Deriving the per-requirement stage attributions in `EVIDENCE.md` and `capstone.yaml` by
  cross-referencing §4, §17, §18.5, and §22 against the stage deliverables in §19. This mapping is
  the assistant's reading of the blueprint, not something the blueprint states line by line — see
  the open question below.
- Producing a `.gitignore` broad enough for tooling that does not exist yet (Vite, Playwright,
  Docker volumes, Mongo dumps) so later stages do not have to remember to add each entry before
  their first commit.

### Where AI failed or was corrected

- **Heredoc quoting failure.** The first attempt to write `README.md` used a shell heredoc through
  the Bash tool. It failed with `unexpected EOF while looking for matching` because the prose
  contains apostrophes that the tool's own command wrapping re-interpreted. No file was written and
  nothing was corrupted. Corrected by writing the documentation files with the editor tool instead
  of the shell. Worth remembering for later stages: prose-heavy files should not go through shell
  heredocs in this environment.
- **Near-miss on the license copyright holder.** The assistant was about to infer the author's
  legal name from the account email address. That is a guess about a real person, so it was not
  done — see open questions.
- **Wrong commit author on the first attempt.** The initial commit was made with an inline
  `user.name` of "Amar" without first checking git's existing configuration, which was already set
  to `amartopalovic`. Caught during post-commit verification and corrected by amending the
  (unpushed, single) Stage 0 commit with `--reset-author`. The lesson is the same one as the
  license line: read the configured value instead of inventing one.

### Judgment calls

1. **Conceptual layout documented rather than empty directories created.** Section 7 item 10 of the
   stage prompt explicitly left this open, and blueprint §6 calls the workspace table "a conceptual
   ownership map, not generated code or a mandate for every directory to exist on day one."
   Creating nine empty `apps/` and `packages/` directories — each with a placeholder file describing
   code that does not exist, all of which Stage 1 immediately overwrites — would make the repository
   look further along than it is. Chose to create only `docs/` (which holds real Stage 0 content)
   and to document the full map in `docs/repository-layout.md` plus a summary table in README §2.5,
   with a "first created in" stage column. Recorded in `docs/repository-layout.md` §1.

2. **`EVIDENCE.md` structured in five parts rather than a flat list.** The stage prompt asked for
   one section per acceptance probe from §18.5 _plus_ placeholders for §4, §17, and §22. A flat list
   would mix six load-bearing capstone gates with ~50 supporting requirements. Split into Part A
   (the six mandatory probes, each with its own section), Parts B–D (product decisions, security
   checklist, cross-cutting proofs, as tables), and Part E (definition of done). The six probes stay
   visually first and unmissable.

3. **Three definition-of-done items marked `IN PROGRESS` rather than `NOT YET IMPLEMENTED`.** E10
   (evaluator files exist), E11 (no secrets in history), and E12 (synthetic-data disclosure) are
   genuinely and partially true today, and marking them "not implemented" would be its own kind of
   inaccuracy. Each states exactly what does and does not hold — for example E11 notes that it holds
   only because no code exists yet and must be re-verified every stage. No item is marked complete.

4. **Stage attributions added to `.env.example` and `capstone.yaml`.** Not required by the prompt.
   Added because a placeholder with no owner tends to stay a placeholder, and it makes it harder for
   a later stage to quietly skip wiring something up.

5. **Two extra files beyond the literal deliverable list.** `docs/repository-layout.md` exists to
   hold the conceptual map from judgment call 1 without bloating the README. The stage prompt
   allowed a sensible location for the design document and left layout documentation to judgment.

6. **License copyright holder written as "Embeddable Widget & Lead-Capture Platform
   contributors".** MIT requires a copyright line, the blueprint names no author, and inferring a
   legal name from an email address would be fabrication. The placeholder is valid MIT and is
   flagged below rather than guessed.

### Verification performed

- Confirmed the pre-existing folder contained only the blueprint file before any writes.
- Confirmed no `package.json`, `node_modules`, source file, or CI configuration was created.
- Confirmed `.gitignore` would exclude `node_modules/`, build output, and `.env` while keeping
  `.env.example` tracked, by test-adding those paths against the real ignore rules.
- Grepped the working tree for credential-shaped strings; all matches were placeholder labels or
  variable names.
- Re-read `README.md` and `docs/architecture-summary.md` against the blueprint to check for
  contradictions.

### Plugin usage this stage

- **`frontend-design`** — installed and available; **not invoked**. Stage 0 produced no React
  pages, components, forms, or visual output, so there was nothing for it to contribute to. It was
  not invoked to manufacture proof of use.
- **`context7`** — installed and available; **invoked once**. Queried the current npm CLI
  documentation to confirm npm workspaces mechanics before asserting them in
  `docs/repository-layout.md` §5: the root `workspaces` array of directory patterns, a single root
  install symlinking workspaces into the root `node_modules`, and
  `npm run <script> --workspaces [--if-present]` / `--workspace=<name>` (`-w`) for script
  execution. Verified rather than written from memory because Stage 1 tooling will be built on it.
- **`typescript-lsp`** — installed and available; **not invoked** for analysis. No TypeScript exists
  in the repository, so there is nothing to type-check or navigate. Availability was confirmed by
  loading the tool.

### Open questions for a human

1. **License copyright holder.** `LICENSE` currently reads "Embeddable Widget & Lead-Capture
   Platform contributors". Replace with the author's legal name or preferred attribution before the
   repository is published.
2. **Stage attributions in `EVIDENCE.md` are inferred.** The blueprint lists requirements and stage
   deliverables separately; the mapping between them is the assistant's reading. Worth a skim to
   confirm nothing important is attributed to a stage that will not actually deliver it.
3. **The monorepo caveat remains an unresolved product risk, not a documentation problem.** It is
   now disclosed in README §3, `docs/architecture-summary.md` §5, and `capstone.yaml`. Whether to
   accept that risk is a decision for the author, and the blueprint locks the npm-workspaces
   decision.
4. **No remote configured.** The repository exists only locally. Creating and pushing to a public
   GitHub repository was explicitly out of scope for this stage and needs an explicit go-ahead.

---

## Stage 1 - Workspace tooling, local infrastructure, and CI baseline (2026-08-28)

**Assistant:** Claude Opus 5, via Claude Code.
**Scope authorized:** Stage 1 only - npm workspace boundaries, shared configuration, local Docker
topology, health skeleton, seed mechanism, and CI baseline. No features.

### What was done

Verified the Stage 0 state was untouched, then created the nine npm workspaces, the shared
configuration package, a six-service Docker Compose topology, a health-endpoint skeleton in
`apps/server`, a seed mechanism, and a GitHub Actions CI baseline. Updated `README.md`,
`capstone.yaml`, `EVIDENCE.md`, `.env.example`, `.gitignore`, `docs/repository-layout.md`, and
`docs/stage-checklist.md` to match what now exists.

Tooling choices, none of which the blueprint dictates:

| Choice                                  | Reason                                                                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Vitest                                  | Vite-native, so the same toolchain covers Node and browser workspaces; no separate Jest/babel config.             |
| ESLint 10 flat config + Prettier        | npm flagged ESLint 9 as end-of-support during install, so the version was raised.                                 |
| Vite                                    | Already required by the React app; reused for the demo and for the widget-runtime library build.                  |
| Tailwind CSS v4 via `@tailwindcss/vite` | Blueprint 14.1 locks Tailwind. v4 is CSS-first, so there is no `tailwind.config.js`.                              |
| `ioredis`                               | BullMQ requires it (blueprint 12.1); choosing it now avoids running two Redis clients from Stage 9.               |
| Official `mongodb` driver               | The readiness probe needs raw connectivity, not an ODM. The Stage 2 data layer can still choose its own approach. |
| Express 5                               | Blueprint 6 specifies Express.                                                                                    |

### Where AI helped

- Reading the blueprint constraints and turning them into a workspace layout, a strict TypeScript
  baseline, and a compose topology in one pass.
- Structuring `apps/server` so the section 6.2 layering rule is physically enforced from the first
  commit: `http/` -> `application/` -> `ports/` <- `infrastructure/`. The health check is the only
  feature, but it already flows through all four layers, so Stage 2 adds repositories without a
  restructure.
- Catching that a "passing" check can be worthless: the lint gate was verified by deliberately
  introducing three violations and confirming ESLint failed on all three, and the CI build step
  has an artifact-existence check so a silently-empty build cannot report success.

### Where AI failed or was corrected

- **Vite version split.** Pinning `vite@^7` in the three browser workspaces while Vitest hoisted
  `vite@8` produced two copies and a wall of incompatible-plugin type errors. Corrected by aligning
  every workspace on `vite@^8` and reinstalling from scratch. The lesson: in a workspace monorepo,
  a shared build tool has to be one version, and the test runner is a voice in that decision.
- **`rootDir`/`outDir` in the shared tsconfig.** These were first placed in
  `packages/config/tsconfig.node.json`. Relative paths in an _extended_ tsconfig resolve against
  the base file directory, so every workspace tried to emit into `packages/config/dist` and `tsc`
  failed with TS6059. Corrected by setting `outDir`/`rootDir` per workspace and documenting the
  gotcha in `docs/repository-layout.md`.
- **Non-portable placeholder scripts.** `packages/config` initially used
  `node -e "process.stdout.write('...\n')"` for its no-op build. The escaped newline broke when
  npm ran the script through bash. Replaced with plain `echo`.
- **Tests leaking into the server build.** The first server `tsconfig.json` included `tests/` with
  `rootDir: "."`, so `npm run build` emitted `dist/tests/` and moved the entrypoint to
  `dist/src/index.js`, contradicting `"main"`. Split into `tsconfig.json` for the build (src only)
  and `tsconfig.test.json` for type-checking (src + tests).
- **Seed script could not reach Mongo from the host.** The driver connected to `localhost:27017`,
  discovered the replica set, and then tried to reach the advertised member `mongo:27017`, which
  does not resolve outside the compose network. Fixed with `directConnection=true` for host-side
  use; transactions still work because the target is the primary. Both URIs are now documented in
  `.env.example`.
- **A messy first draft of the smoke test.** The initial `beforeAll` created a server, closed it,
  and re-created it. Rewritten before it was committed.

### Judgment calls

1. **Compose runs the apps, not just the infrastructure.** The exit gate says one command starts
   "dependencies and empty apps", so all six services are in `docker-compose.yml`. Quality commands
   (`lint`, `typecheck`, `test`, `build`) run on the host, where developers actually run them.

2. **The smoke test uses stub probes, not live Mongo and Redis.** A test that needs Docker is an
   integration test, and Stage 1 is explicitly not the integration-test stage. The smoke test boots
   the real Express app on an ephemeral port and makes real HTTP requests, so it proves routing and
   status codes with no infrastructure - which also means it runs in CI. Readiness against real
   services was verified manually against the running stack and recorded in `EVIDENCE.md`; it
   becomes an automated integration test in Stage 2.

3. **`packages/contracts` exports two real values.** `API_VERSION` and `API_PREFIX` (from blueprint
   10.1) are consumed by `apps/server`, so the cross-workspace build graph is genuinely exercised
   rather than merely configured. A package that exports nothing and is imported by nothing proves
   the boundary exists but not that it works.

4. **CI lists missing checks as comments, never as no-op steps.** Integration, E2E, acceptance,
   bundle-size, accessibility, and secret-scanning checks appear as a TODO block naming their
   owning stage. A step that always passes without doing anything is false evidence, which is the
   same standard Stage 0 applied to `EVIDENCE.md`.

5. **No design tokens in `packages/ui`.** The stage prompt allowed establishing a Tailwind baseline
   or token structure here. Tailwind is wired as _build plumbing_ only, with no theme, palette, or
   tokens: there are no pages to apply them to until Stage 5, and inventing a visual system now
   would lock in choices with nothing to validate them against. This is why `frontend-design` was
   not invoked - see below.

6. **`typecheck` and `test` build the packages first.** `apps/server` imports `@lcp/contracts` from
   its compiled output, so a bare `tsc --noEmit` fails on a clean checkout. Making the root scripts
   self-sufficient is more predictable than relying on developers to remember an ordering rule.

7. **The local `&` path problem was documented, not worked around in config.** See below.

### Verification performed

Every command was executed. Results are in `EVIDENCE.md` (D14, D16, D17, C18) and in the Stage 1
report. In addition to the working folder, the whole repository was copied to a path containing no
ampersand and `npm ci`, `lint`, `typecheck`, `test`, and `build` were re-run there with plain
`npm run` and no shell overrides - all exit 0.

Beyond the happy path:

- MongoDB transactions were proven by committing a real two-collection transaction inside the
  container, rather than assuming the replica set configuration was sufficient.
- Readiness was proven to fail correctly by stopping Redis (503, with liveness still 200) and to
  recover after restarting it.
- The lint gate was proven to fail on deliberate violations.
- ESLint was confirmed to inspect 25 real files, so the clean result is not a vacuous match.

### Plugin usage this stage

- **`context7`** - installed, available, **invoked substantively**. Consulted before writing config,
  and it corrected several things memory would have gotten wrong:
  - **npm** (`/websites/npmjs`): the `workspaces` array, single-root install, and
    `--workspaces` / `--if-present` / `-w` script targeting.
  - **Vitest** (`/vitest-dev/vitest`): `test.workspace` was **removed** in Vitest 4; multi-package
    setups must use `test.projects`. The root config would have been written the wrong way.
  - **typescript-eslint** (`/typescript-eslint/typescript-eslint`): the `tseslint.config()` helper
    is now deprecated in favour of ESLint core `defineConfig()`, which is what the shared config
    uses.
  - **actions/setup-node** (`/actions/setup-node`): current major is **v7**, for both
    `actions/checkout` and `actions/setup-node`. Memory would have written `@v4`.
  - **Tailwind CSS** (`/websites/tailwindcss`): v4 installs via `@tailwindcss/vite` and
    `@import "tailwindcss"`, with no `tailwind.config.js` and no `@tailwind` directives.
  - **MongoDB** (`/websites/mongodb_manual`): confirmed multi-document transactions require a
    replica set, which is why the compose service runs `--replSet rs0` with an initiating
    healthcheck rather than a bare `mongo` image.
  - **Mailpit** (`/axllent/mailpit`): image name and the 1025/8025 port split.
    No conflict with a locked blueprint decision was found.

- **`typescript-lsp`** - installed, but **FAILED and produced no diagnostics**. The plugin requires
  a global `typescript-language-server`, which was not present. It was installed per the plugin
  README (`npm install -g typescript-language-server typescript`, v6.0.0, runs correctly when
  invoked directly), but the LSP tool continued to report
  `Command 'typescript-language-server' not found or is in an unsafe location`. The Claude Code
  process appears to have captured its PATH at startup, before the install. **The LSP half of this
  stage's verification requirement is therefore unmet.** TypeScript correctness rests on `tsc`,
  which passes with zero errors across all nine workspaces. Re-running the LSP check after
  restarting Claude Code is an open item.

- **`frontend-design`** - installed, available, **not invoked**. Stage 1 built no pages,
  components, or visual output; the two app shells are deliberate placeholders and Tailwind is
  wired as build plumbing with no theme. Invoking it would have meant inventing a design direction
  with nothing to apply it to, which the stage prompt explicitly warned against.

### Open questions for a human

1. **The local folder name contains `&`.** On Windows, npm runs lifecycle scripts through
   `cmd.exe`, which treats `&` in a path as a command separator, so `npm run <script>` fails in
   `.../Embeddable Widget & Lead-Capture Platform`. This is a property of the folder name, not the
   project: a `git clone` produces a path with no ampersand, and every command passes on a clean
   path. No workaround was committed, because contorting the project config for a local naming
   accident would be the wrong trade. **Recommend renaming the local folder** (for example to
   `embeddable-widget-lead-capture-platform`). Documented in README section 5.4.
2. **`typescript-lsp` diagnostics are still outstanding** - see above. Restarting Claude Code
   should let the tool find the newly installed binary.
3. **CI has never actually run.** The workflow is committed but no remote is configured, so its
   first real execution will be whenever the repository is pushed. Until then, "CI passes" is a
   claim backed only by running the same commands locally.
4. **A global npm package was installed on this machine** (`typescript-language-server`,
   `typescript`) to satisfy the plugin prerequisite. Remove with
   `npm uninstall -g typescript-language-server typescript` if unwanted.

---

## Stage 2 - Shared contracts, persistence, migrations, and tenancy foundation (2026-08-28)

**Assistant:** Claude Opus 5, via Claude Code.
**Scope authorized:** Stage 2 only - shared contracts, Mongo connection and migrations, base
repositories, the six foundation records, the Redis key policy, structured logging, and
tenant-isolation tests. No authentication, RBAC enforcement, or any feature.

### What was done

Confirmed the Stage 1 commit was intact, verified `typescript-lsp` now works, then built the data
and contract foundation:

- `packages/contracts`: error envelope with a code-to-HTTP-status table, cursor pagination with
  opaque cursors, a Zod-based validation helper, revision preconditions, and the structured log
  record shape with central redaction.
- `packages/database`: Mongo connection with `withTransaction`, an ordered migration runner with a
  ledger, the foundation migration and all its indexes, the tenancy-enforcing base repository, and
  repositories for User, Workspace, Membership, Invitation, AuditEvent, and OutboxEvent.
- `apps/server`: Redis connection and explicit key policy, a `migrate` CLI, and an extended seed.
- `packages/test-utils`: isolated-database fixture and the two-tenant fixture.
- CI: a real integration job running the tests against a live MongoDB replica set and Redis.

Tooling choices the blueprint leaves open:

| Choice                                                  | Reason                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zod 4 for validation                                    | TypeScript-first with static inference, so a schema and its type cannot drift. Re-exported from `contracts` so no other workspace pins its own copy.                                                                                                                                                                                  |
| Hand-written migration runner                           | The requirement is committed, ordered, repeatable migrations plus explicit index management. That is roughly fifty lines against the driver. A framework such as migrate-mongo would add a dependency, a second CLI, and its own file-discovery conventions to own the same behaviour, and would not make the result more repeatable. |
| Official `mongodb` driver, no ODM                       | Repository interfaces are already the abstraction the blueprint asks for. An ODM would add a second, competing one and make the tenancy invariant harder to enforce at the query level.                                                                                                                                               |
| Compose reused in CI rather than `services:` containers | GitHub Actions service containers do support a `command` key, so a replica set is possible there. But the replica set still needs `rs.initiate()` after boot, which the compose healthcheck already performs. Reusing compose keeps one topology definition instead of two that can drift.                                            |

### Where AI helped

- Turning the blueprint section 9.2 constraint table into concrete indexes, and spotting that
  several constraints are conditional rather than absolute. "Unique owner user for active
  ownership" and "unique normalized email" must not block a soft-deleted row from being replaced,
  which means a partial unique index rather than a plain one. Context7 confirmed partial unique
  indexes apply uniqueness only to the filtered subset.
- Designing the tenancy invariant so it is structural rather than a convention: a mandatory first
  parameter, a filter merge order that makes the scope win, and an insert that overwrites a spoofed
  workspaceId. Each of those is a separate failure the tests then probe individually.
- Writing cross-tenant tests in both directions. A one-way isolation test passes even when the leak
  runs the other way, which is an easy and dangerous thing to miss.

### Where AI failed or was corrected

- **A test asserted the wrong thing, and the failure was mine, not the code's.** The case for "a
  caller-supplied workspaceId in a filter cannot override the scope" asserted the query would
  return zero rows. It returned one. On inspection the behaviour was correct and secure: the scope
  is merged last, so the spoofed tenant B id is discarded and the query stays inside tenant A,
  returning tenant A data. The original assertion encoded a misunderstanding of the design. The
  test now asserts what actually matters - every returned record belongs to the caller, and the
  tenant B record is absent. Worth recording because a passing test with the wrong assertion is
  worse than a failing one.
- **Cross-module class identity broke two `toBeInstanceOf` assertions.** The tests import
  `InvalidWorkspaceScopeError` from this package source while the shared fixture resolves
  `@lcp/database` through its built output, so the two classes were different objects. Fixed by
  constructing the repository from source in those specific cases. This is a real hazard for later
  stages: fixtures and tests must agree on which module instance they use.
- **A shared tsconfig lesson from Stage 1 nearly repeated.** `outDir`/`rootDir` still belong per
  workspace, and the new packages follow that; no regression, but it needed conscious attention.
- **Shell heredocs failed twice again** on prose containing an unbalanced quote character. The
  Stage 0 lesson holds: content-heavy files go through the editor tool, not the shell.
- **A Prettier reformat invalidated several documentation patches.** Table alignment and
  `*none*` becoming `_none_` broke exact-string replacements written against the pre-format text.
  Corrected by matching on row identifiers rather than full formatted lines.

### Judgment calls

1. **The logger lives in `packages/contracts`.** Blueprint section 6 defines no observability
   workspace, and the section 16.1 log shape is genuinely a shared contract that the server,
   migrations, and later the workers must all emit identically. Inventing a tenth workspace would
   deviate from the blueprint's own package map for no gain.

2. **Redis lives in `apps/server`, not `packages/database`.** The blueprint scopes
   `packages/database` to "Mongo models, repositories, indexes, and migrations". Redis is not
   Mongo, and only the server process touches it.

3. **Keys are built explicitly instead of using the ioredis `keyPrefix` option.** Context7
   documentation is explicit that `keyPrefix` is not applied to pattern commands such as KEYS and
   SCAN, nor to pub/sub channel names. Relying on it would mean the Stage 8 SSE fan-out channels
   and any cleanup scan silently escaped the namespace. `RedisKeyBuilder` also rejects `:` and
   wildcards in segments, so an untrusted value cannot forge a namespace or turn a lookup into a
   pattern.

4. **`User` carries no credential material at all.** The stage prohibits implementing password
   logic. Including an unused `passwordHash` field would have been a shape decision made without
   the Argon2id parameters and rotation questions that belong to Stage 3, so Stage 3 adds those
   fields through its own migration instead.

5. **`UserRepository` deliberately does not extend the workspace-scoped base.** A user belongs to
   many workspaces, so scoping the identity record to one tenant would be wrong. Tenancy for a user
   is expressed through `Membership`. `WorkspaceRepository` is likewise scoped by its own `_id`
   rather than a `workspaceId` field. Both asymmetries are documented in the source, because an
   unexplained exception to a security invariant is how the invariant later gets eroded.

6. **Unit and integration tests are separate Vitest projects.** `npm run test` needs no
   infrastructure and runs anywhere including a bare CI job; `npm run test:integration` requires
   real Mongo and Redis. Merging them would make the fast suite unrunnable without Docker.

7. **Each integration test file gets its own randomly named database.** That is what lets the
   migration-repeatability test assert against a genuinely clean database, and keeps the files
   order-independent.

8. **Migration idempotency is proven twice over.** The ledger prevents re-application, and each
   migration is independently idempotent. The test that wipes the ledger and replays exists to
   prove the second mechanism actually holds rather than being an untested claim.

### Verification performed

Every command was executed; results are in the Stage 2 report and in `EVIDENCE.md`.

Beyond the happy path:

- Cross-tenant reads, updates, deletes, and inserts were each probed in both directions, and the
  victim record was re-checked afterwards to confirm nothing was silently modified.
- Spoofing was tested at both entry points a caller controls: a `workspaceId` in the document body
  and a `workspaceId` in the filter.
- The runtime scope guard was tested with three distinct bad inputs, including a hex string that
  looks correct but is not an `ObjectId`.
- Migration repeatability was proven by comparing full index descriptors, not just by re-running
  without error, and again with the ledger deliberately wiped.
- The storage constraints were proven to reject bad data rather than merely to exist.
- The CI compose commands were executed locally exactly as the workflow runs them, including the
  replica-set assertion step.

### Plugin usage this stage

- **`typescript-lsp`** - installed, available, and **it worked this time**, unlike Stage 1. The
  Stage 1 diagnosis was correct: the Claude Code process had cached its PATH before
  `typescript-language-server` was installed, and a restarted process picks it up. Used
  substantively for cross-package checking:
  - `findReferences` on `WorkspaceScope` returned 27 references across 7 files, confirming every
    repository consumes the scope type and none bypasses it;
  - `hover` on `WorkspaceScopedRepository.findById` confirmed the signature is
    `(scope: WorkspaceScope, id: ObjectId)`, so the tenancy invariant holds at the type level;
  - `hover` on the `Logger` parameter in the migration runner confirmed the
    `@lcp/contracts` to `@lcp/database` package boundary resolves correctly;
  - `documentSymbol` was used to confirm the language server was live before any work began.

  It also surfaced live diagnostics while editing, including stale cross-package imports before a
  rebuild. Zero unexpected diagnostics remain.

- **`context7`** - installed, available, **invoked substantively**, and it corrected several things
  memory would have gotten wrong:
  - **Zod** (`/websites/zod_dev`): Zod 4 API, and that `treeifyError`/`flattenError` replace the v3
    `format()`/`flatten()` helpers.
  - **MongoDB manual** (`/websites/mongodb_manual`): `createIndexes` is idempotent and reports
    "all indexes already exist", which is what makes the migration safely repeatable; and unique
    partial indexes apply uniqueness only to the filtered subset, which is what the active-owner
    and active-email constraints require.
  - **MongoDB Node driver** (`/mongodb/node-mongodb-native`): in driver 6+, `withSession` and
    `withTransaction` return the callback value, and errors must propagate rather than be swallowed
    or the driver cannot manage transaction state.
  - **ioredis** (`/redis/ioredis`): `keyPrefix` is not applied to pattern commands or pub/sub
    channels. This directly changed the design - see judgment call 3.
  - **GitHub Actions** (`/websites/github_en_actions`): service containers DO support `command` and
    `entrypoint` overrides. This corrected an assumption that a replica set was impossible as a
    service container, and let the compose-reuse decision be made on its merits rather than on a
    false constraint.

  No conflict with a locked blueprint decision was found.

- **`frontend-design`** - installed and available; **not invoked**. Stage 2 built no UI at all.

### Open questions for a human

1. **CI still has never run.** The integration job is committed and its commands were executed
   locally exactly as written, including `docker compose up -d --wait mongo redis` and the
   replica-set assertion. But no remote is configured, so the workflow itself has never executed on
   GitHub. "CI passes" remains a local-equivalence claim until the repository is pushed.
2. **The tenancy invariant is proven only for the six foundation repositories.** Every later stage
   that adds a workspace-owned surface - export, analytics, SSE, trash, recovery - must extend the
   cross-tenant tests. The blueprint requires it for every surface, and `EVIDENCE.md` D2 records
   that gap explicitly rather than implying wider coverage.
3. **The local folder name still contains `&`.** Unchanged from Stage 1: `npm run` fails through
   `cmd.exe` in this directory, so quality commands were run with an explicit bash script shell
   locally. This is a local folder-naming issue, not a repository defect, and no workaround was
   committed. Renaming the folder remains the recommendation.

---

## Stage 3a - Credential authentication backend, Redis sessions, and transactional email (2026-08-28)

**Assistant:** Claude Opus 5, via Claude Code.
**Scope authorized:** Stage 3a only, a sub-stage of blueprint Stage 3. Backend authentication,
sessions, throttles, audit, and email. **No MFA, no UI, no browser E2E** - those are Stage 3b, and
blueprint Stage 3 stays unchecked until they land.

### What was done

Verified `typescript-lsp` worked before touching anything, then built the authentication backend:

- `packages/contracts`: five auth error codes with their HTTP status mappings, and `auth.ts` with
  the request schemas, password-policy constants, session summary, and the single generic
  acknowledgement used by every enumeration-sensitive endpoint.
- `packages/database`: migration `002_auth` extending `User` with credential, verification, reset,
  and lockout fields plus their partial unique indexes; repository methods for token lookup and
  atomic single-use consumption.
- `apps/server`: the full vertical slice - domain password policy and token handling, application
  `AuthService` and `SessionService`, ports for hashing, breach checking, email, sessions, rate
  limiting, and time, and adapters for each, plus the HTTP routes and middleware.

Choices the blueprint leaves open:

| Choice                                             | Reason                                                                                                                                                                                                                                                         |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@node-rs/argon2`                                  | The blueprint locks Argon2id, not a package. The mainstream `argon2` package CANNOT INSTALL here - see below. This one emits identical PHC strings and ships prebuilt binaries with no install script.                                                         |
| Argon2id 64 MiB / t=3 / p=4                        | The current reference recommendation, confirmed via Context7 against the node-argon2 security notes. Stated explicitly so a library default change cannot silently weaken stored hashes.                                                                       |
| Purpose-built session store over `express-session` | Section 10.3 needs per-user indexing, immediate deletion, identifier rotation, and simultaneous idle and absolute lifetimes. Bending `express-session` plus `connect-redis` to all four would have been more code than writing the store, and harder to prove. |
| `csrf-csrf` double-submit                          | `csurf` is deprecated and unmaintained. Context7 confirmed `csrf-csrf` is current and supports binding the token to the session identifier.                                                                                                                    |
| Offline breach list, with HIBP opt-in              | Section 15.1 requires local development to need no external service, and CI must not depend on a third-party API. The offline list always runs; the k-anonymity remote checker only ever adds coverage and fails open.                                         |
| Tokens on the `User` record                        | Section 9.2 defines no auth-token collection, and a user can hold at most one pending verification and one pending reset. Inventing a collection outside the blueprint map was the worse option.                                                               |

### Where AI helped

- Turning section 10.3 into concrete, separately testable properties. "Generic responses prevent
  account enumeration" became three assertions comparing whole responses byte for byte, plus a
  dummy hash verification on the unknown-account path so timing does not leak what the body hides.
- Spotting that the per-flow throttle requirement is not decoration: separate key spaces per flow
  are what stop an attacker exhausting the login limit to deny a victim their password reset.
- Writing the single-use token consumption as one atomic filtered update rather than
  read-then-write, so two concurrent redemptions cannot both succeed.

### Where AI failed or was corrected

- **A dependency could not be installed at all, and the first two fixes did not work.** `argon2`
  runs `cross-env ... node-gyp-build` as an install script, npm runs install scripts through
  cmd.exe, and cmd.exe splits the path on the `&` in the folder name. Passing
  `--script-shell bash` did not help either, because the shim resolution itself breaks. This is
  worse than the Stage 1 and 2 symptom, which only affected `npm run`. Resolved by switching to
  `@node-rs/argon2`, which has no install script - a better dependency here regardless.
- **Two real bugs were caught by the integration tests, not by review.**
  1. CSRF rejections surfaced as **500 instead of 403**. The `csrf-csrf` error carries its own
     status but the error handler had no branch for it, so it fell through to the generic
     server-error path. A security control returning the wrong status is a real defect: it would
     have looked like a broken server rather than a refused request. Fixed by giving the middleware
     an explicit error code and matching it in the handler.
  2. Idle session expiry was enforced **only by the Redis TTL**. The record stored an absolute
     deadline and re-checked it, but nothing equivalent for the idle window, so `touch` trusted the
     TTL alone. That is weaker than the absolute cap for no reason, and it made the requirement
     untestable with a virtual clock. Fixed by storing `idleExpiresAt` and re-checking it the same
     way. The test that exposed this is exactly the one the blueprint asks for.
- **The whole integration suite failed on the first run for a self-inflicted reason.** Every test
  request originates from 127.0.0.1, so the real 5-per-hour registration limit correctly refused
  everything after the fifth test, cascading into 17 failures. Fixed by clearing this harness's
  throttle counters between tests rather than by weakening the production limits, with the
  throttle tests deliberately exhausting them after clearing.
- **A Stage 1 test had to be updated, and that is worth stating plainly.** The 404 handler now
  returns the shared error envelope from section 10.1 rather than a flat `{code, message}`. The
  Stage 1 assertion was asserting the old shape. The test was changed because the BEHAVIOUR
  deliberately improved and is now consistent with every other error, not to make a failure go away.
- **`verbatimModuleSyntax` rejected the library enums.** `@node-rs/argon2` declares `Algorithm` and
  `Version` as ambient const enums, which cannot be imported under that flag. Replaced with pinned
  numeric constants, with the values asserted in tests so a library renumbering fails loudly.
- **The LSP served stale buffers for files edited through shell scripts.** Several times it reported
  errors against line numbers that no longer existed while `tsc` reported zero. `tsc` was treated as
  authoritative and the LSP re-queried afterwards; it re-indexed correctly and the final check is
  clean. Worth knowing: the LSP tracks editor-tool edits reliably and shell edits lazily.
- **Shell heredocs failed again** on an unbalanced quote inside a test name. Same lesson as Stages 0
  and 2; content-heavy files go through the editor tool.

### Judgment calls

1. **Account-level audit events use a sentinel workspace id.** `AuditEvent` is workspace-owned and
   the Stage 2 repository correctly refuses to write without a scope, but authentication happens
   before any workspace is selected. Rather than add an unscoped write path and weaken the invariant
   proven in Stage 2, account events are written against an all-zero workspace id that no real
   tenant can have. Stage 4 writes genuinely workspace-scoped audit through the normal repository.

2. **CSRF protects the authenticated surface only.** The unauthenticated endpoints have no session
   to bind a token to, and a forged request to them achieves nothing an attacker could not do
   directly. They are defended by throttling and generic responses instead.

3. **`SameSite=Lax`, not `Strict`.** The dashboard is same-origin so Lax suffices, and Strict would
   break the top-level navigation arriving from a verification or reset link in an email - the exact
   flow this stage builds.

4. **Login succeeds for an unverified user.** Section 4.1 says unverified users may use the
   dashboard and are blocked only from publishing and inviting. Blocking login would have been a
   stricter reading than the blueprint states, and stricter is still a deviation.

5. **The password policy gates on length and breach status, not composition.** Section 4.2 asks for
   strength FEEDBACK alongside those two rules, and character-class mandates are known to push users
   toward predictable substitutions. Strength is reported and never used to reject.

6. **A `Clock` port was introduced.** Session lifetimes, token expiry, throttle windows, and the
   daily email budget are all time-dependent. Injecting time is what lets the tests cross a 30-day
   boundary in milliseconds and stay deterministic.

7. **The email budget was built now, though nothing competes for it yet.** Section 5.3 splits the
   allowance between critical and side-effect mail; only critical mail exists until Stage 9. The
   guard and its counters are real and tested now, so Stage 9 inherits an enforced budget rather
   than adding one after the traffic exists.

### Verification performed

Every command was executed. Beyond the happy paths:

- Enumeration was probed from three angles - duplicate registration, wrong password versus unknown
  account, and reset request for a known versus unknown address - each comparing full responses.
- Replay was tested for both verification and reset tokens.
- Session isolation was tested by having one user attempt to revoke another user's session.
- Both session lifetimes were crossed deliberately, including proving that activity refreshes the
  idle window but does NOT extend the absolute cap.
- Logout was verified to remove the key from Redis, not merely to return 204.
- Audit records and captured log records were serialised in full and asserted to contain no
  password, session identifier, or hash.
- The email body itself was asserted to leak neither the password nor a hash.
- The budget was driven past both its side-effect cap and its total, and across a day boundary.

### Plugin usage this stage

- **`typescript-lsp`** - installed, available, and **it worked**, checked before any other work as
  the stage required. Used for cross-package verification: `findReferences` on the `PasswordHasher`
  port confirmed it is consumed only through the port by the service and the adapter; `hover`
  confirmed `AuthService.login` resolves to
  `(email: string, password: string, correlationId: string) => Promise<LoginOutcome>` across the
  package boundary; `documentSymbol` confirmed the final indexed structure. It also caught a real
  deprecation live while editing: Zod 4 moved format validators to the top level, so
  `z.string().email()` is deprecated in favour of `z.email()`. Final state: zero unexpected
  diagnostics, cross-checked against `tsc` reporting zero errors.

- **`context7`** - installed, available, **invoked substantively**, and it changed several
  decisions:
  - **node-argon2** (`/ranisalt/node-argon2`): the recommended parameter set, and the existence of
    `needsRehash` semantics worth reimplementing.
  - **Pwned Passwords** (`/lionheart/pwnedpasswords`): the k-anonymity contract, five-character
    SHA-1 prefix and `SUFFIX:COUNT` response lines.
  - **csrf-csrf** (`/psifi-solutions/csrf-csrf`): current `doubleCsrf` options including
    `getSessionIdentifier` and `errorConfig`, confirming this is the live replacement for the
    deprecated `csurf`.
  - **Brevo** (`/websites/developers_brevo`): `POST /v3/smtp/email` with the `api-key` header and
    the exact payload shape.
  - **Zod** (`/websites/zod_dev`, in Stage 2 and revisited here): the v4 API.
    No conflict with a locked blueprint decision was found.

- **`frontend-design`** - installed and available; **not invoked**. Stage 3a built no UI at all. It
  becomes relevant in Stage 3b.

### Open questions for a human

1. **Blueprint Stage 3 is NOT complete.** Its gate names MFA and E2E explicitly. `docs/stage-checklist.md`
   therefore leaves Stage 3 unchecked and records 3a as a completed sub-item. Do not read "Stage 3a
   passed" as "Stage 3 passed".
2. **The `&` in the folder name now blocks dependency installation**, not just script execution. Any
   future dependency with an install script will fail the same way. Renaming the local folder is now
   a stronger recommendation than it was in Stages 1 and 2.
3. **CI still has never run.** The integration job now needs Mailpit as well as Mongo and Redis; the
   compose command in the workflow was updated accordingly and verified locally, but no remote
   exists so the workflow itself remains unexecuted.
4. **The HIBP breach checker is off by default and untested against the live API.** It is opt-in via
   `BREACH_CHECK_REMOTE=true`, fails open by design, and CI never calls it. Only the offline list is
   exercised by tests.
5. **Session rotation on password CHANGE is covered by revoke-all, not by rotation.** A completed
   reset destroys every session including the current one, which is stronger. True in-place rotation
   is used at login; the `rotate` method exists and is typed for the Stage 3b MFA flow, which is the
   next event section 10.3 names.

---

## Stage 3b - TOTP MFA, accessible auth UI, and browser E2E (2026-08-28)

**Assistant:** Claude Opus 5, via Claude Code.
**Scope authorized:** Stage 3b, the second half of blueprint Stage 3.
**This stage COMPLETES blueprint Stage 3**, which is now checked off in
`docs/stage-checklist.md` for the first time.

### What was done

Verified `typescript-lsp` worked, read the whole Stage 3a backend, then added the second factor and
the interface:

- `packages/contracts`: MFA schemas and response shapes, plus two error codes.
- `packages/database`: migration `003_mfa` adding an encrypted TOTP secret, enrollment state, a
  replay counter, and hashed recovery codes to `User`.
- `apps/server`: `SecretCipher` port with an AES-256-GCM adapter, `TotpService` port with an
  `otpauth` adapter, recovery-code domain logic, `MfaService`, a Redis-backed pending-challenge
  store, the `/mfa` router, and the MFA branch in login.
- `apps/web`: eight accessible pages, a typed API client that carries the CSRF token, shared
  components, and Tailwind v4 design tokens.
- `e2e/`: a Playwright suite with axe accessibility checks.

Tooling choices the blueprint leaves open:

| Choice                                                  | Reason                                                                                                                                                                                                                  |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `otpauth` for TOTP                                      | Pure JavaScript with no install script, which matters given the `&` path problem. Its documentation is also explicit that replay prevention via `counter()` is the caller's job, which directly shaped the design.      |
| SHA1 / 6 digits / 30s                                   | Not laziness: Google Authenticator and several other popular apps silently ignore the algorithm and digits parameters in the enrollment URI, so a "stronger" choice would produce codes the user's app cannot generate. |
| Node's built-in `crypto` for AES-256-GCM                | No dependency needed. GCM is authenticated, so a tampered ciphertext fails rather than yielding attacker-chosen plaintext.                                                                                              |
| React Router v8 library mode                            | `createBrowserRouter` + `RouterProvider`, the current approach for a plain Vite SPA.                                                                                                                                    |
| Playwright + `@axe-core/playwright`                     | The framework the blueprint's browser-matrix ambitions point at, and the standard axe integration.                                                                                                                      |
| Native semantic elements, no headless component library | See judgment call 4.                                                                                                                                                                                                    |

### Where AI helped

- Translating "optional TOTP MFA" into the properties that actually make it safe rather than merely
  present: two-phase enrollment, a challenge that issues no session, a replay guard on the accepted
  counter, and re-authentication to disable. None of those are stated in the blueprint; they are
  what the requirement means in practice.
- Noticing that a TOTP code stays valid for its whole 30-second period, so accepting one twice
  would let an observed code be reused. The `otpauth` docs flag this and it is easy to miss.
- Designing the E2E suite to assert the _security_ properties through the UI, not just the happy
  path: byte-identical error text for a wrong password and an unknown account, a recovery code
  refused on its second use, and each revoked device genuinely signed out.

### Where AI failed or was corrected

- **Two real accessibility defects were found by axe and the keyboard test, not by review.**
  1. `placeholder:text-muted/60` computed to roughly **2.6:1** against the panel, well below the
     4.5:1 that AA requires. A faded placeholder looked right and was not. Fixed to full-strength
     muted, which measures about 6.2:1.
  2. A field-level validation error rendered in a plain paragraph while focus stayed on the submit
     button, so a screen reader announced **nothing** on a failed submission. The form-level
     `role="alert"` is now shown for field errors too. The visual design was fine and the
     experience was broken; only the test caught it.
- **An axe failure that was NOT a real defect, and diagnosing it correctly mattered.** Contrast
  violations appeared with colours that were not in the palette at all - `#727791` instead of
  `#5A5F7D`. The panel was still mid-fade when axe measured it, so it was reading blended values.
  The fix is to wait for animations to settle before scanning, not to change the colours: the
  settled page is what a user reads, and a reduced-motion user never sees the transition. Changing
  the palette here would have been fixing the wrong thing.
- **Two E2E tests failed against the replay guard, and the tests were wrong, not the code.** They
  generated a second TOTP code inside the same period the enrollment had already consumed, which is
  precisely what the guard exists to refuse. Corrected by waiting for the next period. A related
  integration test then failed by overcorrecting to `+2` periods, which falls outside the one-period
  drift window - the only acceptable value is exactly `+1`, where the replay guard and the drift
  window meet.
- **The `&` path problem appeared in a third form.** In Stage 1 it broke `npm run`; in Stage 3a it
  broke `npm install` for a package with an install script; here it broke Playwright's `webServer`,
  which spawns `npm run` through `cmd.exe`. Fixed by invoking `node <binary>` directly. `npx` is
  affected too, so the Chromium install and the Playwright CLI are also called through `node`.
- **A test race of my own making.** One MFA test called `enableMfa` without waiting for sign-in to
  complete, so the enroll request raced the login response setting the cookie. It failed as
  "Authentication is required", which reads like a product bug and was not.
- **An intermittent E2E failure turned out to be a real bug, and the first read of it was wrong.**
  MFA setup failed with "That code did not match" about one run in three. It looked like a TOTP
  period boundary, which would have been a test problem. It was not. React StrictMode invokes mount
  effects twice, so `POST /mfa/enroll` fired twice, and each enroll REPLACES the pending secret.
  When the two responses resolved out of order the page displayed one secret while the server had
  stored the other, so the typed code could never match. Fixed with the same `useRef` guard the
  verification page already used for its single-use token. Worth recording for two reasons: the
  fix belongs in product code rather than the test, and a double submit or a remount could
  reproduce it outside StrictMode. Verified by two consecutive clean E2E runs.
- **`verbatimModuleSyntax` and React 19 types.** The LSP flagged `FormEvent` as deprecated - React
  19 types say it "doesn't actually exist" and point to `SubmitEvent` - and separately flagged
  `z.string().email()` as deprecated in favour of Zod 4's top-level `z.email()`. Both were caught
  live while editing rather than at build time.

### Judgment calls

1. **The pending MFA state is a server-side record, not a token.** A signed token handed to the
   client would work, but anything the browser holds between the password and the second factor is
   something an attacker might forge or replay. An opaque handle to a five-minute Redis record,
   destroyed after five failures, gives the client nothing to attack.

2. **Enrollment does not enable MFA.** Only a confirming code does. The alternative - enabling as
   soon as a secret exists - would let a user who closed the tab mid-setup lock themselves out of
   an account they can still log into today.

3. **Disabling MFA is not covered by the "generic response" rule.** A wrong password and a wrong
   code both return the same message, which is right, but the endpoint requires an existing session,
   so there is no enumeration surface to protect. The shared message is about not revealing which
   half was correct.

4. **Native semantic elements instead of a headless component library.** Blueprint 14.1 lists
   "accessible headless primitives" among the UI foundations. For forms the native elements ARE
   those primitives: `<label for>`, `<button>`, and `aria-describedby` need no JavaScript and cannot
   break. A headless library earns its place for dialogs, comboboxes, and tabs, none of which this
   auth surface has. Stage 12 can add one when the dashboard introduces those patterns. This is a
   reading of the blueprint rather than a departure from it, and it is recorded here so a later
   stage can revisit it deliberately.

5. **Design direction, and why it is not generic.** The `frontend-design` skill warns that AI design
   clusters around three looks. The palette here is a cool periwinkle paper with an electric indigo
   signal, which is none of them. The signature is a **mount bracket**: four corner ticks framing
   each auth panel, borrowed from the product's own world, since this platform makes widgets that
   get mounted into someone else's page and an auth form is itself a capture form. It would be
   meaningless on a generic SaaS, which is the point. Monospace is used only where it is
   functional - TOTP codes, recovery codes, session timestamps - because those are read character by
   character and glyph disambiguation matters. Numbered steps appear only in MFA setup, because that
   flow genuinely is an ordered sequence; numbering anything else would be decoration.

6. **Fonts are self-hosted.** Space Grotesk and JetBrains Mono ship as `@fontsource` packages rather
   than a Google Fonts link, so no page depends on an external CDN at run time or test time. That
   keeps blueprint 15.1 true and stops E2E from depending on the network.

7. **The Vite dev server proxies `/api` to Express.** The browser therefore sees ONE origin in
   development. This is load-bearing rather than convenience: the session cookie is host-scoped and
   `SameSite=Lax`, so a cross-origin dev setup would silently drop it and the whole auth surface
   would appear broken for reasons unrelated to the code.

8. **E2E throttle isolation, again.** Every browser test hits 127.0.0.1, so the real per-IP limits
   would make each test spend the next one's allowance. A fixture clears only this run's counters.
   The production limits are untouched, and the throttle tests still exercise them deliberately.

### Verification performed

Every command was executed. Beyond the happy paths:

- Both MFA factors were tested for single use: a TOTP counter cannot be reused, and a recovery code
  works exactly once while a different one still works.
- The challenge was brute-forced deliberately to confirm it is destroyed after five failures.
- Disabling was attempted with a wrong password and a valid code, then a right password and a wrong
  code, before the successful case.
- The stored user document was read directly and asserted to contain neither the base32 secret nor
  any plaintext recovery code, and to carry a well-formed `keyVersion`.
- The cipher was tested against a tampered ciphertext, a tampered authentication tag, an unknown key
  version, and a rotated key ring.
- Accessibility was scanned in error states and with MFA both on and off, not only on pristine
  pages, and a keyboard-only path through registration and sign-in was asserted.

### Plugin usage this stage

- **`frontend-design`** - installed, available, and **invoked substantively**, unlike every prior
  stage where there was no UI to apply it to. It shaped the work in concrete ways: it pushed past
  the three default AI looks it names, which is why the palette is periwinkle-and-indigo rather than
  cream-and-terracotta; it prompted the "spend your boldness in one place" discipline that produced
  the mount bracket as the single signature with everything else kept quiet; and its guidance on
  structural devices is why numbering appears only in MFA setup, where the content genuinely is a
  sequence. Its writing guidance shaped the copy: active voice, an action keeping the same name
  through a flow, and errors that say what to do rather than apologise.

- **`typescript-lsp`** - installed, available, and **it worked**, checked before any other work.
  Used for cross-package verification: `findReferences` on the `SecretCipher` port confirmed it is
  consumed only through the port by the adapter and the service; `hover` on `MfaEnrollment` in
  `apps/web` confirmed the new `apps/web` to `packages/contracts` boundary resolves with its
  documentation intact. It also caught two live deprecations while editing - React 19's `FormEvent`
  and Zod 4's `z.string().email()` - which `tsc` reports only as advisories. Final state: zero
  unexpected diagnostics, cross-checked against `tsc` reporting zero errors.

  One recurring caveat, unchanged from Stage 3a: the LSP serves stale buffers for files edited
  through shell scripts rather than the editor tool, occasionally reporting errors against lines
  that no longer exist. `tsc` was treated as authoritative and the LSP re-queried afterwards.

- **`context7`** - installed, available, **invoked substantively**:
  - **otpauth** (`/hectorm/otpauth`): the TOTP API, the `window` drift parameter, and the explicit
    warning that server-side replay prevention via `counter()` is the caller's responsibility.
  - **Pwned Passwords** (`/lionheart/pwnedpasswords`, Stage 3a) and **React Router**
    (`/websites/reactrouter`): v7/v8 library mode with `createBrowserRouter` and `RouterProvider`.
  - **Playwright** (`/microsoft/playwright`): `defineConfig`, the `webServer` option, and the
    `@axe-core/playwright` `AxeBuilder` fixture pattern with WCAG tag sets.
    No conflict with a locked blueprint decision was found.

### Open questions for a human

1. **Blueprint Stage 3 is now complete and checked off.** All five clauses of its gate are proven,
   and the proof includes real browser interaction rather than only API calls.
2. **E2E covers Chromium only.** Blueprint 14.1 names current Chrome, Edge, Firefox, and Safari.
   Adding the other three is cheap in Playwright but slow in CI, and Stage 13 owns the browser
   matrix, so it was left there rather than pulled forward.
3. **Automated accessibility is a floor, not a certificate.** axe catches roughly a third of real
   problems. The keyboard test covers one thing it cannot, but the manual WCAG 2.2 AA audit is
   Stage 13 and this stage does not claim to have done it.
4. **The `&` in the folder name has now broken three different tools.** Renaming the local folder is
   the standing recommendation and gets stronger each stage.
5. **CI still has never run.** The workflow now has three jobs including browser E2E, all verified
   locally with the same commands, but no remote exists.
6. **Recovery codes cannot be regenerated yet.** A user who spends all ten and loses their
   authenticator has no self-service path back. The count is surfaced in the UI so it is visible,
   but a regenerate flow is genuinely missing and would fit naturally with the account-settings work
   in a later stage.

---

## Stage 4a - Onboarding, workspace context, RBAC policy, and invitations backend (2026-08-28)

**Assistant:** Claude Opus 5, via Claude Code.
**Scope authorized:** Stage 4a, the first half of blueprint Stage 4. Backend only.
**Blueprint Stage 4 is NOT complete** and remains unchecked in `docs/stage-checklist.md`: its gate
says the role matrix must pass "from API through browser", and there is no workspace UI yet.

### What was done

Verified `typescript-lsp`, read the Stage 2/3 foundation being extended, then built:

- `packages/contracts/src/workspace.ts`: capabilities, policy decisions, request schemas, and
  response shapes.
- `packages/database`: migration `004_workspace` (indexes only - Stage 2 already had every field
  needed), plus three narrowly-documented unscoped repository reads.
- `apps/server/src/domain/workspace/`: the section 11 matrix, IANA timezone validation, and the
  30-day recovery window arithmetic - all pure.
- `apps/server/src/application/workspace/`: `WorkspaceService`, `MembershipService`,
  `InvitationService`, and the workspace-scoped audit adapter.
- `apps/server/src/http/`: `requireWorkspaceContext` and `requireCapability`, plus the workspaces,
  members, and invitations routers.
- Session layer: sessions now carry an `activeWorkspaceId`, which is where every workspace-scoped
  route gets its scope.

### Where AI helped

- Turning section 11 from a table into enforcement that is actually checkable. The valuable move
  was writing the test's copy of the matrix **independently from the blueprint** rather than
  importing the implementation's table - otherwise the test proves only that the code equals
  itself. The two are then asserted to cover the same capability set, so neither can drift.
- Noticing that role changes are not a single capability lookup. Whether an action needs
  `member.manage` or `admin.manage` depends on the roles of both parties, which is why
  `canChangeRole` and `canRemoveMember` exist as separate predicates rather than being inlined
  into the routes where each would be re-derived slightly differently.
- Spotting that inviting someone _as an Admin_ is assigning Admin status. The coarse route guard
  only proves `member.manage`, so an Admin would have been able to create another Admin by
  invitation - the exact asymmetry blueprint 4.1 forbids - if the role in the request body were
  not checked separately.

### Where AI failed or was corrected

- **A timezone validator that would have rejected UTC.** The obvious implementation checks
  membership of `Intl.supportedValuesOf('timeZone')`. Verifying it against the actual runtime
  before writing the code showed that list omits `UTC`, `Etc/UTC`, and `Asia/Kolkata` - it carries
  the legacy `Asia/Calcutta` instead. A membership check would have rejected UTC and the canonical
  spelling of a zone used by a sixth of the world. Constructing an `Intl.DateTimeFormat` and
  catching the RangeError accepts every zone the runtime can compute with. This was caught by
  checking rather than assuming, and there is now a test pinning it.
- **`noUncheckedIndexedAccess` on the policy table.** Indexing a complete `Record` still yields
  `| undefined` under that flag. The first version silently satisfied the checker in a way that
  would have made an unknown capability return a value; it now throws instead, because an
  authorization layer returning `allow` or `deny` for something it does not recognise is the worst
  possible failure mode.
- **Express 5 types a route parameter as `string | string[]`.** Six call sites failed to compile.
  A `pathParam` helper takes the first value and treats anything else as absent, rather than
  coercing an array into a string that would then be parsed as an id.
- **Four lint errors after the first full pass**: two type-only imports, an `!=` where the value is
  `Date | null | undefined`, and an empty interface extending its supertype. All small, all real.
- **The `&` path problem did not bite this stage**, because no new dependency was added. That is
  now three stages where it has caused work and one where it did not.

### Judgment calls

1. **The outgoing Owner becomes an Admin.** The blueprint does not say. Section 11 notes that "an
   Owner remains functionally the highest role", which reads as stepping _down_ one rung rather
   than out of the workspace. Admin also keeps them able to undo a mistaken transfer by agreement,
   whereas Member would strip the ability to manage anything. Demoting to Member, or removing them
   entirely, would both be defensible; Admin is the least surprising and the least destructive.

2. **A hand-written policy table instead of an authorization library.** Section 11 is a static
   matrix with no per-record conditions, and CASL's own cookbook recommends a code-defined table
   for exactly that case. Wrapping a literal table in a rules engine would add indirection and make
   "assert every cell" harder rather than easier. Revisit if Stage 8 introduces conditions such as
   "only the assignee may edit this contact".

3. **Pending invitations count toward the 10-user cap.** Blueprint 4.10 caps users, not
   invitations. Counting only accepted memberships would let ten simultaneous invites overshoot the
   cap the moment they were all accepted, so pending ones are counted and the cap holds.

4. **Verification auto-accepts waiting invitations.** Someone invited before they had an account
   cannot redeem the link until they are verified. Rather than making them find the original email
   again, verification joins them to every invitation waiting for that address. Each is still
   consumed exactly once, and nothing runs for an unverified identity, because it happens only
   after verification succeeds. Wired at the route rather than inside `AuthService`, so the auth
   layer keeps no workspace dependency.

5. **Three unscoped repository reads, each documented at its definition.** `listAllForUser`,
   `listPendingForRecipient`, and the token-hash redemption all answer questions that cannot be
   asked from inside a single workspace. Each filters on something the caller owns - their own user
   id, their own email, or a globally-unique token they hold - so none can surface another tenant's
   data. The redemption lookup is wired in the composition root rather than added to the scoped
   repository, so the exception is visible in one place instead of becoming a general escape hatch.

6. **Membership is re-checked on every request, not cached in the session.** The session stores
   only _which_ workspace is selected; the role is resolved per request. Caching the role would
   make revocation take effect at the next switch rather than immediately, and there is a test for
   the immediate case.

7. **Recovery takes the workspace id in the path.** Every other route derives scope from the
   session, but a deleted workspace cannot be the _active_ one - `requireWorkspaceContext` refuses
   it by design. Ownership is therefore checked directly in that handler, and a non-owner gets 404
   rather than 403 so a deleted workspace is not revealed to someone who cannot restore it.

8. **Unbuilt usage meters report null, not zero.** A zero would assert "no widgets exist yet",
   which is a different claim from "widgets are not built yet". There is a test asserting null.

### Verification performed

Every command was executed. Beyond the happy paths:

- The role matrix is exercised twice: once as a pure unit table covering all 48 cells for both
  verified and unverified subjects, and again over HTTP for the rows that have routes.
- Enumeration was probed: switching into a stranger's workspace, recovering someone else's deleted
  workspace, and removing another tenant's member all return 404 rather than 403.
- Both invitation recipient paths were tested, including asserting the membership count before and
  after verification to prove none is created for an unverified identity.
- An intercepted invitation link was tested against a different signed-in verified user.
- Ownership transfer was verified to leave exactly one owner membership and to actually move the
  powers, not just the field.
- The recovery window was tested on both sides by moving `purgeAfter` into the past.
- Cross-tenant isolation was re-proven on the new mutation paths, not just the Stage 2 reads.
- The Stage 3b browser E2E suite was re-run after the session record changed shape: 17 passed, no
  regression.

### Plugin usage this stage

- **`typescript-lsp`** - installed, available, and **it worked**, checked before any other work.
  Used for cross-package verification: `findReferences` on `can()` returned 17 references across
  exactly three files - the policy module itself, the middleware guard, and the tests - confirming
  no route bypasses the engine; `findReferences` on the new `activeWorkspaceId` field returned 8
  across 4 files, confirming every consumer of the changed session shape was updated. It also
  surfaced the `noUncheckedIndexedAccess` and Express-5 param problems live. Zero unexpected
  diagnostics remain, cross-checked against `tsc` at zero errors.

  Same caveat as prior stages: the LSP indexes files lazily, so a brand-new file needs a
  `documentSymbol` call before `findReferences` returns anything.

- **`context7`** - installed, available, **invoked substantively**:
  - **CASL** (`/stalniy/casl`): its roles-with-static-permissions cookbook, which recommends a
    code-defined table when permissions are known at build time. That corroborated the decision NOT
    to take the dependency, which is a legitimate outcome of consulting documentation.
  - **Intl / IANA timezones**: the resolver found no useful library match, so the approach was
    verified directly against the runtime instead - which is what surfaced the `supportedValuesOf`
    gap described above. Documented here because "consulted and found nothing useful, then verified
    empirically" is the honest account.
    No conflict with a locked blueprint decision was found.

- **`frontend-design`** - installed and available; **not invoked**. Stage 4a built no UI. It
  becomes relevant again in Stage 4b.

### Open questions for a human

1. **Blueprint Stage 4 is NOT complete.** Its gate requires the role matrix to pass through the
   browser. Stage 4b owns the workspace UI and that E2E. Do not read "Stage 4a passed" as "Stage 4
   passed".
2. **The outgoing-owner role is a judgment call**, not a blueprint decision - see judgment call 1.
   Worth a sentence of confirmation before Stage 4b builds UI copy around it.
3. **Invitation expiry is enforced on read, not swept.** An expired invitation is filtered out and
   refused, but its record stays `pending` until Stage 11's retention sweep. That is consistent with
   how the rest of the soft-delete machinery waits for Stage 11, but it does mean a stale row lingers.
4. **Capabilities for widgets, contacts, exports, and deliveries are answered but unattached.** The
   policy engine is complete and tested for all 16 rows; Stages 5, 8, and 9 must remember to attach
   `requireCapability` to the routes they add. Nothing enforces that they will.
5. **CI has still never run.** Unchanged since Stage 1: no remote is configured.

---

## Stage 4b - Workspace UI, onboarding flow, and browser E2E (2026-08-28)

**Assistant:** Claude Opus 5, via Claude Code.
**Scope authorized:** Stage 4b, the second half of blueprint Stage 4.
**Blueprint Stage 4 is now COMPLETE** and is checked off in `docs/stage-checklist.md`. Its gate
asks for the role matrix "from API through browser"; Stage 4a delivered the API half and this
stage delivers the browser half.

### What was done

Verified `typescript-lsp` (see below - it needed a restart first), read the whole Stage 4a
backend, then built:

- `apps/web/src/pages/`: `OnboardingPage`, `WorkspaceHomePage` (usage meters),
  `MembersPage` (roster, invitations, role controls), `AcceptInvitationPage`, `AuditLogPage`,
  and `WorkspaceSettingsPage` (ownership transfer and the danger zone).
- `apps/web/src/components/WorkspaceShell.tsx`: the minimal shell - switcher, nav, and the single
  place workspace state is loaded and shared.
- `apps/web/src/lib/`: `workspace-context.ts`, `navigation.ts` (`safeNext`), and `workspaceApi`
  added to the existing client rather than a second one.
- `apps/web/src/components/ui.tsx`: `RoleChip` and `Meter`.
- `e2e/`: `helpers/journeys.ts` plus `workspace-journey.spec.ts` (12 tests) and
  `workspace-accessibility.spec.ts` (8 tests).
- Server, to make the UI possible without duplicating policy: `GET /workspaces/current` now
  returns the caller's derived capability list, `GET /members` returns per-member
  `assignableRoles` and `canRemove`, and `GET /workspaces/recoverable` was added.

### Where AI helped

- Spotting that the obvious way to build this - map role to visible controls in React - would
  have created a second copy of the section 11 matrix. The requirement was to drive the UI from
  what the API reports, and the API reported only a _role_. Having the server derive and return
  the capability list, and the per-member decisions, is what makes "one copy of the policy" a
  literal fact rather than an aspiration. `findReferences` on `can()` now shows the same function
  behind the guard and behind what the UI reads.
- Catching that per-member decisions cannot be expressed as a flat capability list at all.
  "Admins manage Members but only the Owner touches Admin status" depends on both roles at once,
  so `assignableRoles` is computed per row by the same `canChangeRole` the mutation route uses.
- Noticing that a soft-deleted workspace was undiscoverable. Recovery existed in Stage 4a, but a
  deleted workspace is hidden from the switcher and cannot be the active workspace, so after a
  reload nothing could name it. Without `GET /workspaces/recoverable` the required recovery UI
  would have been a button that only worked in the same page session.
- Reading the invitation email subject out of the code instead of guessing it, and reading the
  emitted audit event types out of the services rather than inventing plausible ones. One
  invented case (`membership.created`) was written and then removed once the real list was
  checked - it is never emitted.

### Where AI failed or was corrected

- **I invented an outcome the server does not produce.** The acceptance page had a "This
  invitation is for someone else" state for a signed-in user whose address does not match. Stage
  4a deliberately returns `invalid_token` there, with a comment saying why: distinguishing "not
  yours" from "not real" would confirm that an intercepted link is a live invitation. The E2E
  test failed and was right to. The branch was removed and the test rewritten to assert the
  actual, better behaviour - identical wording either way - plus the two things that matter: the
  interloper joins nothing, and the real invitation stays pending. A neutral suggestion to sign
  out and try another account is now shown for _all_ failures, which helps the honest case
  without confirming anything.
- **A sign-in race.** `signIn` clicks and returns without waiting, which is correct for the auth
  tests that submit bad credentials and stay put. Two new tests then navigated immediately and
  raced the response that sets the session cookie, so the destination rendered signed-out. Added
  `signInAndLand`, which waits for the app to leave `/login`, rather than weakening assertions.
- **`?next=` leaked into a URL the auth tests assert on.** Adding invitation return-to support
  made login send `/mfa-challenge?next=%2Fworkspace` even for the default destination, breaking
  two Stage 3b tests. The fix was in the product, not the tests: the parameter is only attached
  when the destination is not the default.
- **A duplicate `data-testid`.** `RoleChip` renders in the shell and again in a page heading, so
  `getByTestId('role-owner')` matched two elements. Scoped the assertions to the banner.
- **`useCan` was dead code.** I exported a hook and then never used it; lint does not flag an
  unused export. `findReferences` returned exactly one reference - its own declaration - and it
  was removed.
- **The suite exhausted the daily email budget, and I nearly called it a flake.** The final run
  failed with `No "Join " email ... within 20000ms` on a test that had just passed. The UI had
  said "Invitation sent", so the send path was fine. The cause was real:
  `lcp:e2e:quota:email:2026-08-28:total` had reached 300, the Stage 3a Brevo day budget, after
  four suite runs. The guard was _working_ - deferring rather than exceeding a provider cap - but
  it made the suite unrepeatable within a UTC day. Fixed in the fixture that already resets
  throttle counters, on the same reasoning it documents: only this run's counters are cleared,
  under this run's own key prefix, and the guard keeps its unit and integration coverage. Verified
  by re-running from an exhausted counter: 37 passed.

### Judgment calls

1. **No headless component library, again - but decided, not defaulted.** Stage 3b left this open
   for the first genuine composite widget, and this stage had two candidates. A native `details`
   disclosure gives the switcher a focusable trigger, keyboard toggling, and an announced expanded
   state for free; a native `select` is precisely the right primitive for choosing one of two
   roles; and destructive actions reuse the inline-confirmation pattern from turning off two-step
   verification rather than becoming modals. A library would have added behaviour to re-implement
   and nothing a user gains. Reconsider in Stage 12, which brings real dialogs and comboboxes.
2. **A component guard, not a route loader.** React Router 8 supports loaders in data mode, and
   the current docs present `redirect` from a loader as the idiomatic guard. Every existing page
   in this app fetches from a component, so introducing a second data paradigm for four routes
   would cost more in consistency than the extra render costs. Stage 12 can move the surface to
   loaders wholesale.
3. **Post-sign-in now lands in the workspace, not on `/account`.** `AccountPage` said in its own
   comment that it was "deliberately NOT a dashboard" and that this arrives in Stage 4. Fifteen
   assertions in the Stage 3b suite were updated to match, via two named constants in
   `fixtures.ts` so the decision lives in one place. This is a deliberate behaviour change, not a
   regression, and the pages themselves are untouched.
4. **Onboarding is not gated on a verified email.** Section 4.1 blocks only "publishing and
   invitations" for unverified users and says the dashboard is available, and journey 1 in
   section 18.3 is ordered "Register, onboard, verify, sign in". So an unverified user reaches
   onboarding and the workspace, and is refused only at the invite form.
5. **Name and timezone are read-only.** Stage 4a exposes no endpoint that changes them. A form
   posting to something that does not exist would be a worse lie than a read-only row.
6. **Unmeasured usage meters draw an empty dashed track**, labelled with the stage that will fill
   them, rather than a zero-width bar. The API sends `null` precisely so that "nothing yet" and
   "not counted yet" stay distinguishable; a confident 0 would throw that away in the UI.
7. **Recovery lives on the onboarding screen.** That is where an owner who has just deleted their
   only workspace is sent, so it is where the offer to restore it belongs.
8. **The switcher collapses to plain text with one workspace.** A disclosure that reveals a list
   of one is noise.
9. **Auto-select the first workspace when a session has none.** Signing in creates a session with
   no active workspace, so a returning member would otherwise land nowhere. The id comes from the
   list the server just returned, and `/switch` re-verifies membership before writing.

### Verification performed

Every command run from a clean tree, in this order:

```
npm run format:check   All matched files use Prettier code style!
npm run lint           exit 0
npm run typecheck      exit 0
npm run build          exit 0
npm test               Test Files 7 passed (7)   Tests 125 passed (125)
npm run test:integration   Test Files 6 passed (6)   Tests 110 passed (110)
npm run test:e2e       37 passed (5.2m)
```

The E2E suite went 30/7 then 36/1 before reaching 37/0; each failure is described above. The 17
pre-existing browser tests all pass, as do the 106 pre-existing integration tests.

### Plugin usage this stage

- **`typescript-lsp` - worked, after a restart it needed.** On first contact it was serving a
  _stale buffer_: it resolved `can()` at line 101 of a file where line 98 was correct, and it
  returned byte-identical results after a real on-disk change. The server had been running since
  before the Stage 4a formatting pass, and it never re-reads a file it has opened. Killing it
  (it respawns) fixed the offsets exactly. Verified afterwards with two deliberate type errors,
  both reported at the right lines. Used substantively for the `apps/web` to `packages/contracts`
  boundary (`MemberSummary.canRemove` resolves across the package edge), to prove one copy of the
  policy via `findReferences` on `can()`, to confirm only the two intended auth pages touch
  `safeNext`, and to find the dead `useCan`. **Operational caveat, worth knowing for later
  stages:** because it never re-reads changed files, `tsc` was treated as the authority during
  editing and the LSP was restarted before the final diagnostics.
- **`context7` - consulted.** React Router: confirmed loaders with `redirect` as the current
  guard idiom in data mode, which informed judgment call 2 (documented as a deliberate departure
  rather than an oversight). Resolved the library to `/remix-run/react-router`; note the indexed
  docs are v7 while this repo is on 8.3.0, so the finding was treated as directional.
- **`frontend-design` - applied.** The skill was loaded earlier in this session and its guidance
  was followed here rather than re-invoked, per this session's instruction not to re-execute
  already-loaded skills. Its influence is concrete: the brief pinned the visual direction to
  Stage 3b's system, so the work was extension rather than reinvention. Role became the
  organising structural device, expressed as one `RoleChip` treatment in the established mono
  micro-type everywhere a role appears, and the active row in the switcher carries a
  signal-coloured left edge that echoes the auth panel's corner ticks. Numbered markers were
  explicitly rejected - onboarding is one step and a roster is not a sequence. The boldness stays
  spent on the existing mount-bracket signature, and the new surfaces are quiet by comparison.

### Open questions for a human

1. **A workspace's name and timezone cannot be changed by anyone.** The API has no endpoint, so
   an owner who mistypes their workspace name is stuck with it. Worth an early settings endpoint
   rather than waiting for Stage 12.
2. **A removed member sees a generic failure.** Revocation takes effect on the next request, and
   the shell simply redirects them; it does not say "you were removed from that workspace".
3. **Expired invitations still show as pending** until Stage 11's sweep. They are refused on use,
   and the list shows the expiry date, but the row does not say "expired".
4. **Capabilities for widgets, contacts, exports, and deliveries are answered but unattached.**
   Stages 5, 8, and 9 must remember to attach `requireCapability`; nothing enforces that they do.
5. **CI has still never run**, because no remote is configured.

---

## Stage 5a - Widget domain model, drafts, and publishing backend (2026-08-29)

**Assistant:** Claude Opus 5, via Claude Code.
**Scope authorized:** Stage 5a, the first half of blueprint Stage 5. Backend only.
**Blueprint Stage 5 is NOT complete** and remains unchecked in `docs/stage-checklist.md`: the
React settings-form builder, its live preview, the embed-snippet surface, and the browser journey
are 5b.

### What was done

Verified `typescript-lsp`, read the Stage 2 tenancy base and the Stage 4 workspace layer being
extended, then built:

- `packages/contracts/src/widget.ts`: the three locked types, the seven field types, a closed
  appearance vocabulary, triggers/CTA/success/cooldown as discriminated unions, targeting, and the
  request schemas.
- `packages/database`: `WidgetRecord` and `WidgetRevisionRecord`, two `WorkspaceScopedRepository`
  subclasses, and migration `005_widget`.
- `apps/server/src/domain/widget/`: pure rules - field/mandatory validation, host and wildcard
  matching, safe-glob page matching, CTA/redirect validation, publish readiness, per-type defaults,
  and public-id/snippet generation.
- `apps/server/src/application/widget/widget-service.ts`: create, save draft, publish, unpublish,
  soft-delete, recover, list, detail.
- `apps/server/src/http/routes/widgets.ts`: the API, wired to the three EXISTING section 11
  capability rows.
- `workspace-service.usage()`: `activeWidgets` changed from a hard-coded null to a real count.

### Where AI helped

- Deriving the two bounds the blueprint leaves open instead of inventing them. Blueprint 7.3
  already says submissions reject "long-text values above 5,000 characters", so pinning the
  builder's field maximum to the same 5,000 is the only value that cannot produce a form whose own
  submissions the server would refuse.
- Noticing that the draft-conflict mechanism was not actually a free judgment call. Blueprint 10.1
  states it: "Update operations that can conflict use revision/version preconditions and return 409
  on stale writes" - and Stage 2 had already seeded a `STALE_REVISION` error code mapping to 409
  that nothing used yet.
- Spotting that "at most one draft per widget" is implied by 4.5's singular "a draft revision" but
  is not in 9.2's index list, and that enforcing it with a partial unique index is stronger than
  trusting each write path.
- Declining a glob library. Picomatch's own docs show brace expansion, extglobs, negation, and
  POSIX classes, with `maxExtglobRecursion` defaulting to 0 because quantified patterns are risky.
  That is a large surface for patterns a tenant supplies, so the matcher escapes everything and
  reintroduces only `*` and `**` - which a test pins by asserting the compiled regex source.

### Where AI failed or was corrected

- **I modelled the publish state with one field too few.** Unpublishing cleared
  `publishedRevisionNumber` along with the live pointer, so a widget that had been published and
  taken down was indistinguishable from one never published, and reported itself as a `draft`. I
  caught this reading my own lifecycle function rather than from a failing test. Split into
  `publishedRevisionId` (currently live) and `lastPublishedRevisionNumber`/`lastPublishedAt`
  (publish history, retained across unpublish).
- **I wrote a genuinely bad test helper.** A `toObjectId` function that inspected a collection's
  constructor and fell back to `require()` inside an ESM test - convoluted and wrong. Replaced with
  a plain `import { ObjectId } from 'mongodb'`.
- **Three integration tests failed on first run, and two of them were the test being wrong, not
  the code.** The draft-editing test assumed a draft still existed after publishing; it does not,
  because publishing promotes the draft and 4.5 says the next edit CREATES one. The trash test
  advanced the clock 31 days and then got 401, then 404 - both correct: a 31-day jump is past the
  absolute session lifetime, and a fresh session has no active workspace. Fixed by re-signing in
  and re-selecting the workspace, rather than shortening the jump and no longer crossing the window
  the test exists to check.
- **One failure WAS a real intentional change:** a Stage 4a test asserted
  `usage.activeWidgets.used` is null. Stage 5a makes that meter real, so the assertion was updated
  to an honest `0` while keeping the null assertions for the two meters that are still genuinely
  unmeasured.
- **The language server served stale buffers again**, twice, reporting errors for code I had
  already fixed while `tsc` read the same files clean. Same cause and same fix as Stage 4b: it does
  not re-read a file it has opened. `tsc` was treated as authoritative during editing and the
  server restarted before the final diagnostics pass.

### Judgment calls

1. **Field maximum length: 5,000 characters**, in one shared constant
   (`WIDGET_FIELD_MAX_LENGTH`). Derived from blueprint 7.3's submission-side limit rather than
   chosen, so the builder cannot express a form the submission endpoint would reject. Per-field
   defaults are much smaller (254 for email, 40 for phone); 5,000 is the ceiling, not the default.
2. **Draft conflicts: optimistic concurrency on an integer `version`.** Every accepted draft write
   matches and increments the version inside one atomic `findOneAndUpdate`, so two teammates saving
   at once cannot both succeed; the loser gets 409 `stale_revision` plus the current version to
   rebase onto. `expectedVersion` is mandatory in the schema - there is deliberately no
   "just overwrite" path. A first write to a widget that has no draft yet carries version 0, which
   is what a client sees when `draft` is null.
3. **Publishing promotes the draft row in place, once.** One row per revision number, and its
   content is exactly what was reviewed. The alternative - copying the draft into a new published
   row - would leave two rows with the same content and make "which revision did the visitor get"
   ambiguous. Immutability is preserved because every write path filters on `status: 'draft'`.
4. **A widget's `status` is the soft-deletion lifecycle, not the publish state.** Whether it is
   servable is `publishedRevisionId !== null`. Overloading one field with both would have made
   "deleted but previously published" unrepresentable.
5. **Soft-delete clears the live pointer.** A deleted widget is servable to nobody, and it makes
   "restoring does not automatically republish" (4.5) fall out of the model rather than needing a
   rule.
6. **The 10-widget cap is checked, not indexed.** A count is not expressible as a unique index, so
   a determined concurrent pair of creates could exceed it by one. That is a visible, self-
   correcting overage on a demo quota, not a security boundary; a workspace-level lock on every
   create would cost more than the problem.
7. **Draft saves are not audited.** Blueprint 9.3 lists role, publish, export, delete, restore,
   merge, and settings changes. A draft save is autosave-shaped, and recording every one would bury
   the events that matter. What goes live is audited, at publish.
8. **Reading widgets uses `workspace.view`.** Section 11 has no "view widgets" row, and this is the
   same row the workspace-context and members endpoints already use. No capability was invented.

### Verification performed

```
npm run lint               exit 0
npm run format:check       All matched files use Prettier code style!
npm run typecheck          exit 0
npm run build              exit 0
npm test                   Test Files 8 passed (8)   Tests 162 passed (162)
npm run test:integration   Test Files 7 passed (7)   Tests 131 passed (131)
npm run test:e2e           37 passed (5.2m)          (no regression; unchanged from Stage 4b)
npm run migrate            applied 4, skipped 1, then applied 0, skipped 5 on a second run
```

Indexes were read back from the real database rather than assumed; see EVIDENCE Part D-detail.

### Plugin usage this stage

- **`typescript-lsp` - worked.** Verified first with two deliberate type errors, both reported at
  the right lines, and with `Capability` resolving across the `apps/server` to
  `packages/contracts` boundary into all 16 union members. Used substantively to confirm
  `CAPABILITIES` has exactly two references - its declaration and the `Capability` type derivation
  - which is the direct evidence that this stage added no capability name; to navigate the
    `WorkspaceScopedRepository` base while writing the two new repositories; and for a final
    documentSymbol pass over the widget service after a restart. Caveat unchanged from Stage 4b: it
    does not re-read externally changed files, so it went stale twice and `tsc` was the authority
    during editing.
- **`context7` - consulted, and one consultation changed the design.** MongoDB Node driver:
  `createIndexes` options and partial indexes, though the in-repo Stage 2 precedent
  (`partialFilterExpression: { status: 'active' }`) was the more authoritative pattern and is what
  005 follows. Zod: `discriminatedUnion` and `superRefine` in v4, which is why triggers, CTA
  actions, success outcomes, and cooldowns are unions rather than objects full of optional fields.
  Picomatch: its options reference and the note that risky quantified extglobs are treated
  literally by default - which is what decided me against taking a glob dependency at all.
- **`frontend-design` - available, deliberately not invoked.** There is no React work in this
  stage, so there was nothing for it to shape. It is required again in 5b.

### Open questions for a human

1. **Wildcard depth.** `*.example.com` admits `eu.app.example.com`, not just one label. The
   blueprint says "explicit wildcard subdomains" without fixing the depth; single-label-only is the
   defensible alternative. Documented and unit-tested either way, but worth confirming before
   customers rely on it.
2. **The embed snippet's shape is now frozen.** It is printed into customer pages, so changing
   `/widget/v1/loader.js` or the `data-widget` attribute later breaks every installation. Stage 6
   must build the loader to match rather than the other way round.
3. **A widget's `name` is edited through the draft endpoint**, so renaming needs a draft write.
   That is convenient but slightly odd, since the name is widget-level rather than revision-level.
4. **Nothing enforces that Stage 6 and 7 actually call the matching functions.** `isHostAllowed`,
   `isPageTargeted`, and the published-revision lookup exist and are tested, but only the runtime
   and submission endpoints can make them load-bearing.
5. **CI has still never run**, because no remote is configured.

---

## Stage 5b - Widget builder, live preview, and browser E2E (2026-08-29)

**Assistant:** Claude Opus 5, via Claude Code.
**Scope authorized:** Stage 5b, the second half of blueprint Stage 5.
**Blueprint Stage 5 is now COMPLETE** and is checked off in `docs/stage-checklist.md`.

### What was done

- `apps/web/src/pages/WidgetsPage.tsx`: the widget list, the create form, and the trash view.
- `apps/web/src/pages/WidgetBuilderPage.tsx`: the two-pane builder, save/publish/unpublish/delete,
  the draft-conflict flow, the "Live now" panel, and the embed snippet.
- `apps/web/src/components/WidgetSettings.tsx`: every setting from blueprint 4.3-4.5, built from
  native form controls.
- `apps/web/src/components/WidgetPreview.tsx`: the live preview.
- `apps/web/src/components/ui.tsx`: `WidgetStateChip` and `CopyField`.
- `packages/contracts/src/widget.ts`: `mandatoryFieldsFor` and `collectsSubmissions` moved here
  from the server so the builder and the validator share one implementation.
- `e2e/`: `widget-journey.spec.ts` (12 tests) and `widget-accessibility.spec.ts` (8 tests), plus
  widget helpers in `helpers/journeys.ts`.

### Where AI helped

- Spotting that the builder needed the mandatory-field rule and that copying it into React would
  recreate exactly the drift problem Stage 4b set out to avoid. Moving the function into the
  shared package was a small refactor that makes "one copy" literally true - `findReferences`
  now shows one declaration and two consumers.
- Rendering the preview as a rendering rather than a form. A preview full of disabled inputs would
  have put a second copy of every field into the accessibility tree, with duplicate labels, for no
  benefit - nothing in a preview is meant to be operable.
- Noticing that the builder had no answer to "what is live right now". This surfaced as a failing
  assertion rather than as a design review, but the fix was a product one, not a test one.

### Where AI failed or was corrected

- **A real staleness bug in the save path.** Saving immediately after a keystroke ran a handler
  still closed over the previous render's config, so the OLDER value was persisted and the server
  cheerfully accepted it. The E2E suite caught it in the one test where the stale value happened to
  be valid and the new one was not: a `javascript:` redirect was "saved" successfully. This is the
  silent-lost-edit failure the whole optimistic-concurrency design exists to prevent, arriving by a
  completely different route. Fixed by reading the pending configuration from a ref at click time.
  Worth stressing: this only showed up in the full-suite run, and my first instinct on seeing one
  test fail in the full run but pass in isolation was "flake" - which would have been wrong.
- **I asserted the wrong thing in the exit-gate test.** After the Member's save I expected the
  owner's builder to still show `Original headline`. It shows `Member edit`, correctly, because the
  builder edits the draft. The assertion was wrong AND it exposed a genuine gap: nothing in the UI
  reported the live revision. Added the "Live now" panel, which is what the gate now asserts
  against - a better test and a better product than the one I first wrote.
- **A real contrast defect, found by axe.** The preview muted whole field elements with
  `opacity: 0.55`, rendering placeholder text at `#7e7f8a` on white - 3.96:1, under the 4.5:1 bar.
  Borders and text now scale separately. Stage 6's runtime would have inherited this.
- **Two locator mistakes of my own making.** `getByLabel('Name')` matched both the name field and a
  type radio, because one radio's description begins with the word "Name"; and I asserted a Member
  sees a "View" link when every role holds `widget.draft.write` and therefore sees "Edit".
- **Two tests navigated away and did not come back.** `invite()` moves the page to the members
  page; I then kept operating on the builder. `createPublishableWidget` now returns the builder URL
  so callers can return deliberately.
- **A page can hold more than one live region.** `getByRole('status')` became ambiguous once the
  copy control added its own, so the helpers assert on the message text instead.

### Judgment calls

1. **Explicit save, not autosave.** Every write can be refused as stale, and an autosaving builder
   would surface that conflict at unpredictable moments. An explicit save makes the conflict land
   when the creator asked for something, which is when they can act on it.
2. **The conflict flow keeps the creator's work on screen** and offers two named choices - keep
   mine, or discard mine and reload. Silently reloading would be the data loss the 409 exists to
   prevent; silently overwriting would be the other half of it.
3. **Publishing saves first when the draft is dirty.** "Publish" means what is on screen, not what
   was last saved, and requiring two clicks to get there would invite publishing a stale draft.
4. **The preview is framed as a fragment of someone else's page** - a tinted, dashed surround with
   the existing mount-bracket corner ticks. This is the one flourish on the surface, and it is the
   product's own metaphor rather than decoration: a widget is a guest on a site we do not control.
   Deliberately not fake browser chrome with traffic lights, which would decorate rather than
   inform.
5. **Field position is shown as a number** (`01`, `02`). Numbered markers are usually decoration,
   but here order is a real setting the creator controls and the visitor sees, so it encodes
   something true.
6. **Widget type is chosen with radios, not a select.** There are exactly three, blueprint 4.3
   locks the list, and each needs a sentence of explanation - which a dropdown would hide.
7. **The copy control keeps the snippet in a read-only input.** Clipboard access is a permission
   that can be refused, and someone installing a snippet must always be able to select it by hand;
   the button is a convenience on top, never the only route.
8. **Still no headless component library.** The builder is fieldsets, inputs, selects, checkboxes,
   radios, and buttons - native elements are the accessible primitives for all of them. The
   question stays open for Stage 12's dialogs and comboboxes.

### Verification performed

```
npm run lint               exit 0
npm run format:check       All matched files use Prettier code style!
npm run typecheck          exit 0
npm run build              exit 0
npm test                   Test Files 8 passed (8)   Tests 162 passed (162)
npm run test:integration   Test Files 7 passed (7)   Tests 131 passed (131)
npm run test:e2e           57 passed (8.4m)          (37 existing + 20 new)
```

### Plugin usage this stage

- **`frontend-design` - invoked and used substantively.** The brief pinned the visual direction to
  the existing system, and the skill is explicit that a brief's own words win, so the work was
  coherent extension rather than reinvention. Its influence is concrete: it pushed me to find one
  signature element and keep everything else quiet, which produced the "their page" preview framing
  and the mount-bracket payoff; it pushed me to question numbered markers, which is why field
  positions are numbered (order is real information) while nothing else is; and its guidance on
  copy shaped the empty and error states - "No widgets yet. Create your first one below." rather
  than an illustration, and "Publish this widget to get its embed snippet" rather than a disabled
  control with no explanation.
- **`typescript-lsp` - worked, and stayed accurate this stage.** Verified up front with two
  deliberate type errors cross-checked against `tsc`. Used substantively to prove the shared
  mandatory-field rule has one declaration and two consumers, and for a clean diagnostics pass over
  the builder after a restart. It did go stale once mid-stage after external edits, the same
  behaviour as Stages 4b and 5a; `tsc` was the authority during editing.
- **`context7` - not consulted.** The prompt asked for it only if a genuine API question arose. It
  did not: React 19, React Router 8, Playwright, and axe were all already in use in this repository
  with established local patterns, and inventing a consultation would have been theatre.

### Open questions for a human

1. **The preview is the dashboard's rendering, not the runtime's.** Its content cannot diverge from
   what is saved, but its visuals can diverge from what Stage 6 actually paints. Keeping them
   honest will need either shared rendering code or a visual check in Stage 6.
2. **No low-contrast warning.** A creator can pick a text/background pair that fails WCAG in their
   own widget and nothing says so. Worth a builder-side check, especially since the platform holds
   itself to AA.
3. **Renaming a widget goes through the draft endpoint**, which is convenient but odd, since the
   name is widget-level rather than revision-level. Unchanged from 5a.
4. **The 10-widget cap has no UI affordance** until it is hit, when the server's `quota_exceeded`
   message appears. A meter is on the overview page, but the create form does not pre-empt it.
5. **CI has still never run**, because no remote is configured.

---

## Stage 6 - Cached public loader and framework-free widget runtime (2026-08-29)

**Assistant:** Claude Opus 5, via Claude Code.
**Scope authorized:** Blueprint Stage 6, complete.

### What was done

- `apps/server/src/application/widget/public-widget-service.ts` and
  `src/http/routes/public-widget.ts`: the public config endpoint, the generated loader, and the
  content-hashed runtime, mounted outside session and CSRF handling.
- `packages/widget-runtime/src/`: registry, instance lifecycle, Shadow DOM rendering, stylesheet,
  triggers, and cooldown - framework-free, no React, no Zod.
- `packages/contracts/src/widget-rules.ts`: Stage 5a's matching rules moved here so the runtime
  uses the same implementation the server validates with; `@lcp/contracts/rules` is a
  zero-dependency entry point so the barrel's Zod dependency stays out of the public bundle.
- `apps/demo`: a hostile host page on a second origin, installing widgets from `?w=`.
- Bundle budgets in the unit suite, sizes printed in CI.

### Where AI helped

- Noticing that the runtime needed 5a's rules and that the obvious options were both bad: importing
  server code into a browser bundle, or copying the rules and letting them drift. Moving them into
  a shared zero-dependency entry point is the third option, and the one that keeps blueprint 7.2's
  split between server and browser honest.
- Spotting the Zod hazard before it shipped. `@lcp/contracts` depends on Zod, so importing its
  barrel from the runtime would have quietly put a validation library on customer websites. The
  subpath export prevents it and a test asserts it, rather than trusting the bundler.
- Deriving the ETag from the public id and revision rather than from a body hash, so it is stable
  across processes and restarts.
- Working out that focus behaviour has to differ by how the widget opened. A modal the visitor
  clicked should take focus; a popover that appears on a timer must not, because moving focus under
  someone mid-task is hostile. Both cases are tested.

### Where AI failed or was corrected

- **I put backticks inside a template literal.** A CSS comment I wrote referred to
  `* { box-sizing: content-box !important }` in backticks - inside the JS template string that
  builds the stylesheet. It terminated the string and broke the build. The build error was one line
  of Vite output that I nearly skimmed past because the grep on the next line still printed a
  result from the previous build.
- **I changed the stylesheet and did not rebuild the bundle**, then spent a round theorising about
  CSS specificity to explain a test failure that was simply stale output. The server reads the
  runtime from disk once at startup, so a rebuild also needs a restart - now written down in the
  README as a real operational limitation rather than a thing I have to remember.
- **My first box-sizing fix was wrong in an interesting way.** I used
  `*, *::before, *::after { box-sizing: inherit }`, which is the standard idiom - but the value it
  inherits comes from the HOST element, which lives in the host page's light DOM and can be forced
  to `content-box !important` there. Inheritance is exactly the channel Shadow DOM does not block.
  Stating `border-box` outright is immune.
- **I asserted something the blueprint does not promise.** A test expected an unpublished widget to
  vanish from a page on the next load; blueprint 8.2 gives the config a 60-second TTL, so a browser
  may legitimately keep showing it for up to a minute. The test now uses a fresh context with an
  empty cache and proves what is actually guaranteed: the server stops serving immediately.
- **A trigger test raced the runtime.** Clicking a trigger before the loader, runtime, and config
  had finished three async hops meant nothing was wired yet. Fixed with a deterministic wait on the
  registry rather than a sleep - which also states the real precondition.
- **I nearly called that one a flake.** It failed in the suite and passed alone, which is the exact
  shape that invites a retry rather than a diagnosis.
- **The full suite then found a real lost-edit bug I had shipped in Stage 5b.** Two tests failed
  intermittently with "This widget is not ready to publish" - a widget published without the
  allowed domain that had just been typed into it. Not a timeout: the page said so. The cause was
  in the builder, not the tests. `load` is a `useCallback` over `useNavigate`, React Router does
  not promise that function is referentially stable, so the mount effect can re-run - and when it
  did, it replaced whatever the creator had typed with the last saved copy. That is the same
  silent-lost-edit failure the optimistic-concurrency design exists to prevent, arriving from
  inside the page instead of from a teammate. A dirty guard on the reload fixes it. Two things
  worth noting: it only reproduced in a full 12-minute run, and the honest reading of "passes
  alone, fails in the suite" was a real bug rather than contention.
- **One genuinely timing-sensitive pre-existing test.** The Stage 3b MFA-disable test submits a
  TOTP code that is only valid for the rest of its 30-second period; under a loaded run the period
  can roll between generating and submitting. It now waits for a fresh period when the current one
  is nearly spent, rather than being left to fail in a way that looks like a broken feature.

### Judgment calls

1. **The shadow root is OPEN, not closed.** Closed hides the root from the host page's script but
   not from a determined one, and CSS isolation - the property that actually matters - is identical
   either way. Open keeps the widget inspectable by the site owner who installed it, and both
   Playwright and axe traverse open roots, so the tests examine what a visitor really gets.
2. **The loader is generated server-side as a string.** It must name the current hashed runtime
   URL; a pre-built loader would need rewriting on every runtime build.
3. **The runtime is hashed once at startup**, not per request. Hashing per request would be waste;
   the cost is that a rebuilt bundle needs a restart, which is documented.
4. **The allowed-domain list is not in the public config.** It is not renderable, the server is the
   authority on it, and shipping an allowlist to the client it constrains invites tampering. The
   runtime therefore does not do domain matching at all - the server refuses first.
5. **Include/exclude patterns ARE in the public config**, because one cached answer is shared by
   every page on the site and only the browser knows which page this is. That is blueprint 7.2's
   own split, step 5 versus step 7.
6. **A missing Origin header is refused.** Browsers send it on cross-origin requests, so its
   absence means this is not the browser fetch the endpoint exists to serve.
7. **Failure is silent in the runtime.** A refused Origin, an unpublished widget, or a network
   error leaves the customer's page exactly as it was. A widget that cannot load should be
   invisible, never an error message on somebody else's site.
8. **Storage failures degrade toward showing the widget.** Private modes throw on localStorage; a
   widget that cannot remember its cooldown shows again, which is mildly annoying rather than
   broken.
9. **`/widget` is proxied through the web dev server.** Blueprint 5.1 puts the API, the dashboard,
   and the widget assets on one Render service, so a snippet naturally points at one origin.
   Proxying reproduces that locally instead of inventing a second base URL production never uses.
10. **The submission handler is an empty typed seam.** Stage 7 owns the endpoint; the form renders
    and validates but posts nowhere, which is a seam rather than a half-implementation.

### Verification performed

```
npm run lint               exit 0
npm run format:check       All matched files use Prettier code style!
npm run typecheck          exit 0
npm run build              exit 0
npm test                   Test Files 10 passed (10)   Tests 183 passed (183)
npm run test:integration   Test Files  8 passed (8)    Tests 146 passed (146)
npm run test:e2e           72 passed
npm run migrate            no new migration this stage

measured bundle sizes
  widget runtime   13,613 B raw    5,439 B gzip     budget 20,480 / 8,192
  widget loader       734 B raw      434 B gzip     budget  2,048 / 1,024
```

### Plugin usage this stage

- **`frontend-design` - applied to the widget's own output.** Its guidance shaped what the widget
  looks like on somebody else's page: one quiet panel that states every property it depends on
  rather than inheriting, a focus ring the host page cannot remove, a single 160ms entrance that
  respects `prefers-reduced-motion`, and no decoration that does not serve the brief. The restraint
  principle is why the widget has no chrome of its own beyond a close control - it is a guest, and
  the creator's appearance settings are the design system, not ours.
- **`typescript-lsp` - worked.** Verified up front with two deliberate type errors cross-checked
  against `tsc`, resolving `WidgetConfig` from contracts into the runtime package. Used to confirm
  the runtime consumes the shared rules rather than a copy, and for a clean diagnostics pass. It
  went stale twice after external edits, as in Stages 4b and 5; `tsc` was the authority while
  editing.
- **`context7` - consulted three times, all load-bearing.** MDN on `attachShadow`,
  `adoptedStyleSheets`, and `CSSStyleSheet.replaceSync`, which informed the open-vs-closed decision
  and the styling approach. Express on ETag generation and `req.fresh`, which is what made me stop
  relying on framework-implicit 304s and set an explicit validator instead. And Picomatch, whose
  option surface confirmed the Stage 5a decision not to take a glob dependency still held for a
  bundle that ships to customer sites.

### Open questions for a human

1. **No Redis config cache yet.** Blueprint 8.2 says "Publish invalidates Redis", but there is no
   cache layer to invalidate - every config request reads Mongo. Correct, and fine at this scale,
   but the caching that line describes is still to come.
2. **Exit intent is untested in the browser suite.** It is unit-tested for the degradation rule and
   wired in the runtime, but simulating a real pointer leaving the viewport top is unreliable in
   headless Chromium, so it is not asserted end to end.
3. **The click-trigger contract is `data-lcp-widget-open="<publicId>"`** and is documented nowhere a
   customer would find it. Stage 12's public docs should cover it.
4. **A widget with only an exit-intent trigger never opens on touch devices.** That is the
   blueprint's rule working as written, but the builder does not warn a creator who configures it.
5. **CI has still never run**, because no remote is configured.

---

## Stage 7 - Hardened public submission path (2026-08-29)

**Assistant:** Claude Opus 5, via Claude Code.
**Scope authorized:** Blueprint Stage 7, complete. All six PDF acceptance probes now pass locally.

### What was done

- `packages/database`: `Contact`, `SubmissionEvent`, `ConsentEvent`, and `AbuseEvent` records with
  their repositories, and migration `006_submissions`.
- `packages/contracts`: the submission payload schema, the size limits from blueprint 7.3, and the
  uniform acknowledgement shape.
- `apps/server/src/domain/submission/`: honeypot and timing heuristics, the rotating IP pseudonym,
  and the monthly quota with workspace-timezone boundaries - all pure.
- `apps/server/src/infrastructure/geo/`: ip-api and ipapi.co adapters, a null provider, and the
  fallback chain, behind a port.
- `apps/server/src/application/submission/submission-service.ts`: blueprint 7.3's eleven rules in
  order, ending in one transaction over contact upsert, immutable event, consent evidence, and the
  durable outbox record.
- `POST /widget/v1/submit/:publicId` with CORS preflight, the three Redis rate limits, and a
  response that is byte-identical for an accepted and a discarded submission.

### Where AI helped

- Keeping the accepted and discarded paths from drifting. Blueprint 7.3 step 10 wants a uniform
  response, so the route writes the acknowledgement in exactly one place and a test asserts the two
  responses are byte-identical. Two separate `res.json` calls would have passed review and then
  slowly diverged.
- Noticing that "monthly quota" is a timezone question. Blueprint 4.10 says month boundaries use
  the WORKSPACE timezone, so a workspace in Auckland rolls over roughly half a day before a UTC
  server would say it did. Doing the comparison inline against UTC would have quietly given some
  tenants a shorter month than others.
- Choosing HMAC over a hash for the IP pseudonym, and writing down why: the IPv4 space is small
  enough to enumerate completely, so a SHA-256 of an address is a lookup table rather than a
  pseudonym.
- Enforcing idempotency in the database as well as Redis. Redis holds the 24-hour replay answer,
  but it is a cache that can be flushed, and "a retry creates no duplicate event" has to survive
  that. A unique index on `{ workspaceId, idempotencyKey }` does.
- Treating the geo port as a testability requirement rather than tidiness. Blueprint 18.4 asks for
  deterministic provider tests, and "A down, B enriches" cannot depend on a third party actually
  being down when the suite runs.

### Where AI failed or was corrected

- **I wrote to the wrong database.** The service took a `MongoClient` and called `client.db()` with
  no argument, which returns the connection string's DEFAULT database - not the one the app uses,
  and definitively not the per-run database the test harness creates. Fifteen integration tests
  failed at once, several with a 500. Taking the `Db` handle explicitly and getting sessions from
  `db.client` fixed it. The lesson is narrow and worth keeping: a convenience accessor that
  "usually" resolves to the right thing is a bug waiting for a second environment.
- **A required consent checkbox could never be submitted.** The consent field's `maxLength`
  defaults to 1 because the builder treats it like a text field, and the submission validator
  applied that limit to the value `true` - four characters. So every ticked consent box was
  rejected as "too long". An integration test caught it; the validator now skips length checks for
  a field whose value is a boolean word.
- **A geo provider that threw could reject a lead.** The port asks implementations never to throw,
  but "asks" is not a guarantee, and the chain did not catch. A provider that rejected instead of
  returning null produced a 500 on the most important write path in the product. The chain now
  absorbs it and continues - which is also what makes the "provider throws" half of probe A5
  meaningful.
- **My tests assumed a clean database per test.** The harness gives the whole FILE one database, so
  assertions like "one contact exists" were quietly becoming "seventeen do". Added a per-test
  cleanup of the collections this path writes.
- **I compared client wall-clock time against a fixed server clock.** The harness drives a
  `MutableClock`, so `Date.now()` in a test is not the server's idea of now. A deliberately
  too-fast submission came out with a NEGATIVE elapsed time, which the heuristic leniently accepts,
  so the timing test failed for a reason unrelated to the rule it was checking. The test now reads
  the harness clock. The leniency itself is correct and stays.

### Judgment calls

1. **Idempotency is stored durably, not just in Redis.** The blueprint says a key is "retained for
   24 hours", which Redis does; the unique index is what makes the guarantee survive a cache flush.
   The replay answer is reconstructed from the stored event rather than cached separately, so there
   is one source of truth for what the original response was.
2. **Geo timeout: 1.5 seconds per provider.** Both are consulted in the worst case, so this is half
   the enrichment budget. Comfortably above a healthy round trip and low enough that two failures
   cost three seconds rather than hanging the request.
3. **Geo is off outside production.** ip-api's free endpoint allows 45 requests a minute per source
   address and its terms exclude commercial use - fine for a portfolio demo, not fine for a test
   suite. `GEO_ENABLED` defaults to false and the tests inject scripted providers.
4. **HMAC key rotation is by derived subkey, monthly, with the period stored alongside the value.**
   Rotation needs no new secret provisioned, a leaked period key exposes one month, and an event
   written last month stays interpretable.
5. **A missing `renderedAt` is accepted, not rejected.** It is client-supplied and trivially
   omitted by a determined bot, so treating absence as guilt would only cost real visitors whose
   browser or extension interfered. The honeypot is the check with teeth.
6. **The timing floor is 1.5 seconds.** Deliberately low: the cost of a false positive is a
   silently discarded real lead, which is the worst failure this path has.
7. **A rate-limited attempt costs one widget lookup** to record the abuse event blueprint 7.4 asks
   for. The refusal happens first; the bookkeeping is off the fast path and failures in it are
   swallowed.
8. **`AbuseEvent` has no field for captured values.** Not "we do not populate it" - the type does
   not have one, so a later stage cannot add values by accident.
9. **Contacts are unique per workspace, not globally.** One person contacting two customers is two
   separate leads, and a test asserts exactly that.
10. **A submission refreshes canonical contact values EXCEPT ones a human edited.** Blueprint 4.6
    requires manual edits to survive; `manuallyEditedFields` records which, and Stage 8's editing UI
    will populate it.

### Verification performed

```
npm run lint               exit 0
npm run format:check       All matched files use Prettier code style!
npm run typecheck          exit 0
npm run build              exit 0
npm test                   Test Files 11 passed (11)   Tests 204 passed (204)
npm run test:integration   Test Files  9 passed (9)    Tests 171 passed (171)
npm run migrate            applied 1, skipped 5, then applied 0, skipped 6 on a second run
```

Indexes were read back from the real database rather than assumed; see EVIDENCE Part D-detail.
No browser E2E was required this stage - there is no UI in it - and the existing 72 browser tests
were left untouched.

### Plugin usage this stage

- **`typescript-lsp` - worked.** Verified up front with two deliberate type errors cross-checked
  against `tsc`, resolving `WorkspaceScope` across the package boundary. Used for a clean
  diagnostics pass over the submission service and to confirm `isOriginAllowed` resolves to the
  shared `@lcp/contracts` implementation rather than a local copy - the reuse the stage brief asked
  for. It went stale once after external edits, as in earlier stages; `tsc` was the authority while
  editing.
- **`context7` - consulted three times, all load-bearing.** Node's crypto docs confirmed that
  `timingSafeEqual` THROWS on a length mismatch, which is why the comparison checks lengths first
  rather than letting it throw. ioredis confirmed the `SET key value EX n NX` argument order and
  that it returns null when NX fails. ip-api's own documentation supplied the details that shaped
  the adapter and the configuration default: the free endpoint is HTTP-only, limited to 45 requests
  a minute per source address, reports failure in the BODY with a 200 status, and excludes
  commercial use.
- **`frontend-design` - available, deliberately not invoked.** There is no UI in this stage.

### Open questions for a human

1. **Nothing consumes the outbox.** That is Stage 9 by design, but until then a submission produces
   no notification at all, and the `pending` rows will accumulate.
2. **The widget's form still posts nowhere.** The Stage 6 runtime stops at a typed seam. Wiring it
   to this endpoint is small, but it belongs with Stage 8's inbox so the result is visible.
3. **ip-api's free tier forbids commercial use.** Fine for a portfolio demo, and the adapter is
   behind a port - but a real deployment would need the paid tier or a different provider.
4. **The quota counts submissions with a `countDocuments` per request.** Correct, and cheap at this
   scale given the index, but blueprint 4.10 mentions Redis quota counters and Stage 10 may want
   one.
5. **Consent is recorded as opt-in evidence only.** Double opt-in confirmation and withdrawal are
   Stage 11; the record type already has the event types for them.
6. **CI has still never run**, because no remote is configured.

---

## Stage 8a - Contact inbox backend: search, lifecycle, merge, export, SSE (2026-08-29)

**Assistant:** Claude Opus 5, via Claude Code.
**Scope authorized:** Blueprint Stage 8, sub-stage 8a of 2. API, persistence, and the SSE stream
only. No UI - 8b brings the inbox screens, the timeline, bulk-action controls, and browser E2E.

### What was done

- `packages/database`: the `ContactActivity` record and repository, a `merged` lifecycle state and
  `mergedIntoContactId` on `Contact`, and migration `007_contact_inbox`.
- `packages/contracts`: the inbox filter, list query, workflow/canonical/merge/bulk/export schemas,
  the response shapes, and the workspace SSE event contract.
- `apps/server/src/domain/contact/`: search planning, keyset cursor arithmetic, bulk permission
  resolution, and merge planning - all pure.
- `apps/server/src/application/contact/`: the inbox service and the streaming CSV/JSON writers.
- `apps/server/src/infrastructure/redis/event-hub.ts`: Redis pub/sub fan-out on a dedicated
  subscriber connection.
- `apps/server/src/http/routes/contacts.ts` and `events.ts`: fourteen endpoints and one SSE stream.

### Key decisions

1. **Concurrency guards the record's `version`, not an edit-only counter.** One mechanism then
   prevents two different overwrites: a teammate's concurrent edit bumps the version, and so does a
   later SUBMISSION, because the Stage 7 upsert increments it. So an edit composed against values a
   submission has since refreshed is refused rather than silently winning. The check is part of the
   update FILTER (`findOneAndUpdate` on `{_id, workspaceId, version}`), not a read followed by a
   write, because those two leave exactly the gap this exists to close. The complementary half -
   a submission never overwriting an EDITED value - stays `manuallyEditedFields` from Stage 7.
   Concurrency protects the human from the machine at write time; the field list protects the
   human's decision permanently.
2. **Workflow writes are deliberately NOT version-guarded.** Blueprint 9.3 puts optimistic
   concurrency on "Contact canonical values". Status, assignee, and tags are what every role edits
   all day, and making two teammates tagging the same lead a 409 would be a worse inbox while
   protecting nothing. The version still increments, so a canonical edit that raced a workflow
   change is still caught.
3. **Cursor shape: base64url of `{v, id}`, compared as a two-clause keyset.** Offset pagination is
   refused for a reason specific to this product: the inbox is sorted by last submission and new
   leads arrive while someone is reading it, so `skip` re-shows a row on page 2 that page 1 already
   showed. The `_id` tiebreaker is doing two jobs - MongoDB's documentation is explicit that `$sort`
   is not stable and needs a unique field for deterministic order, and that same field is what lets
   the cursor resume from an exact position inside a group of equal timestamps. The token carries no
   workspace id; it is opaque to clients, not an authorization input.
4. **SSE fan-out is Redis pub/sub, on a duplicated connection.** Pub/sub rather than streams because
   SSE is a live feed and a subscriber that was not connected has no claim on an event it missed;
   streams would add durable retention nothing consumes and a consumer-group lifecycle per browser
   tab. The separate connection is a requirement, not tidiness: ioredis documents that a client
   entering subscriber mode accepts only subscription commands, so sharing the application client
   would have broken sessions, rate limits, and idempotency the moment the first dashboard
   connected. Publishing through Redis rather than an in-process emitter means the Stage 9 worker
   can already reach every dashboard without anything here changing.
5. **Search is a substring regex, not a text index.** A text index matches whole words with
   stemming, so "acme" would not find "acmecorp.com" and "smit" would not find "Smith" - both of
   which are what someone typing into a search box expects. The term is escaped so it cannot act as
   a pattern, and every query is bounded to one tenant.
6. **The filter spans two collections, so it is resolved in two steps.** Status, assignee, and tags
   live on the Contact; widget, domain, page URL, geo, and the captured values live on the immutable
   event. Event-side dimensions resolve to contact ids first. The two combine differently and the
   difference matters: a dimension filter NARROWS (intersect), a search term WIDENS (union), because
   a contact matches if their name matches OR one of their submitted values does.
7. **A merge only ever fills a gap.** The survivor is named by the caller, per 9.3; what is decided
   mechanically is per field, and the rule is that a merge can add information and never destroy it.
   If both have a phone number, the survivor's stays and the duplicate's is still visible in the
   events being re-linked.
8. **A merged duplicate is `merged`, not trashed.** Recovering it from the 30-day trash would
   resurrect a contact whose events now belong to someone else, so it is kept out of the inbox and
   the recovery list alike. `merged` is a contact-only state rather than a widening of the shared
   `RecordStatus`, since no other record merges.
9. **Notes are activity entries, not a field on the Contact.** Blueprint 4.6 says notes belong to
   the Contact rather than to a submission, which this satisfies while also giving each note an
   author and a timestamp - a single string field could not say who wrote what.
10. **The export is an allowlist of columns and is streamed.** Never a record dump: the record
    carries a version counter, a purge schedule, and a merge pointer that no export should publish,
    and enumerating what goes out means a field added later is not silently handed to every past
    consumer. It shares the list's query builder, which is what makes "matches your active filter"
    structural rather than a promise.

### Where AI failed or was corrected

- **The status filter rejected every real request.** `?status=qualified` returned 400, because the
  schema accepted only an array and Express parses a parameter that appears once as a STRING. Two
  integration tests caught it. The schema now accepts both forms and normalises to an array. Worth
  keeping: the shape a query string actually arrives in is not the shape the TypeScript type
  suggests.
- **The CSV formula guard could be stripped by the reader.** A value starting with `=` was prefixed
  with a tab but left unquoted, and several CSV parsers strip leading whitespace - which would have
  removed the guard and handed the formula straight back to the spreadsheet. Guarded values are now
  always quoted.
- **A NUL byte ended up in the service source.** A tag-set comparison had been written as
  `next.join(sep) !== previous.sort().join(sep)` with a literal NUL as the separator, which made
  `grep` treat the whole file as binary. Replaced with an element-wise comparison that needs no
  separator at all - which is also more correct, since any separator character can appear inside a
  tag and make two different sets compare equal.
- **`http/app.ts` was moved to `infrastructure/app.ts` outside of my edits**, breaking every route
  import and `src/index.ts`. Caught by `typecheck` immediately after a clean run, so the cause was
  narrow. Moved back; the Stage 8a edits in it were intact.
- **My SSE test parser counted the protocol preamble as an event.** The stream opens with
  `retry: 3000`, which has no `data:` line; a test waiting for "any frame" therefore finished before
  the real event arrived, and reported the wrong reason. The parser now ignores frames without data.
- **`typescript-lsp` went stale again**, reporting line numbers from before an edit and omitting a
  function that had just been added. Same workaround as previous stages: kill the language-server
  process, let it respawn, re-run. `tsc` stayed the authority while editing.

### Verification performed

```
npm run lint               exit 0
npm run format:check       All matched files use Prettier code style!
npm run typecheck          exit 0
npm run build              exit 0
npm test                   Test Files 12 passed (12)   Tests 238 passed (238)
npm run test:integration   Test Files 10 passed (10)   Tests 209 passed (209)
npm run migrate            applied 1, skipped 6, then applied 0, skipped 7 on a second run
```

Migration 007's indexes were read back from the real database rather than assumed; see EVIDENCE
Part D-detail. No browser E2E was required this sub-stage - there is no UI in it - and the existing
72 browser tests were left untouched.

### Plugin usage this stage

- **`typescript-lsp` - worked.** Used for navigation across the new service and, more usefully, to
  verify a claim rather than assert it: go-to-definition on the `can()` call in the bulk-permission
  module resolves to `domain/workspace/capabilities.ts:115`, proving the Owner/Admin-vs-Member
  split comes from the section 11 matrix and not from a second table written for bulk. It went
  stale once (above) and was restarted for a clean final pass.
- **`context7` - consulted three times, all load-bearing.** ioredis's documentation established that
  a connection entering subscriber mode accepts only subscription commands, which is why the event
  hub takes a duplicated connection rather than the shared client - a detail that would have
  surfaced as sessions breaking under load rather than as an obvious error. MongoDB's documentation
  confirmed that `$sort` is not a stable sort and that a unique field must be included for
  deterministic ordering, which is the justification for the four-part indexes in migration 007.
  Node's stream documentation confirmed that `pipeline` applies backpressure and propagates errors
  when the source is an async generator, which is how the export avoids buffering.
- **`frontend-design` - available, deliberately not invoked.** There is no UI in this sub-stage.

### Open questions for a human

1. **Nothing consumes the outbox still.** A lead now arrives live on the dashboard stream, but no
   email or webhook is sent (Stage 9).
2. **The reconnect replay buffer is process-local**, holding 50 events per workspace. Correct for
   one web process, which is what version 1 deploys; a second process would need the buffer moved
   into Redis, at which point a stream is the better structure than pub/sub.
3. **Membership revocation is enforced within one heartbeat** (25 seconds) rather than instantly.
   A revocation channel would close that window; it costs a second subscription per workspace and
   the exposure is bounded and small, so it is deliberately deferred.
4. **Search resolves at most 5,000 matching events per query.** Ample at portfolio scale, and the
   cap is what keeps a broad search from becoming an unbounded id list, but a large workspace would
   want the search moved into an aggregation rather than a two-step resolve.
5. **Trashed contacts are marked with `purgeAfter` but never swept.** The 30-day promise is
   recorded; executing it is Stage 11's retention automation.
6. **The widget's form still posts nowhere.** Wiring the Stage 6 runtime's typed seam to the Stage 7
   endpoint belongs with 8b, where the resulting lead is visible in the inbox.
7. **CI has still never run**, because no remote is configured.

---

## Stage 8b - Contact inbox UI, timeline, bulk actions, and browser E2E (2026-08-29)

**Assistant:** Claude Opus 5, via Claude Code.
**Scope authorized:** Blueprint Stage 8, sub-stage 8b of 2. **Stage 8 is complete with this entry.**

### What was done

- `apps/web/src/pages/ContactsPage.tsx`: the inbox - search, the nine filter dimensions behind a
  disclosure, keyset pagination, deterministic sort, bulk selection with a capability-driven action
  bar, inline merge, and the live-arrival button.
- `apps/web/src/pages/ContactDetailPage.tsx`: workflow controls for every role, canonical editing
  for Owner/Admin with a designed conflict state, and the merged timeline.
- `apps/web/src/pages/ContactTrashPage.tsx`: the 30-day trash and recovery.
- `apps/web/src/lib/use-workspace-events.ts`: the SSE subscription, with bounded backoff on hard
  failures.
- `apps/web/src/lib/api.ts`: `contactApi` and the shared query-string builder.
- `apps/web/src/components/ui.tsx`: `ContactStatusChip`, `Select`, `TextArea`.
- `e2e/tests/contact-journey.spec.ts` and `contact-accessibility.spec.ts`: 16 new browser tests.

### Key UI decisions

1. **New leads queue; they do not inject themselves.** Blueprint 13.1 asks for live updates, and
   the obvious reading is "insert the row". That is the wrong behaviour for a list somebody is
   working: an inserted row moves the thing they were about to click, and it silently changes what
   a bulk selection covers. Arrivals increment a count in a polite live region, and the row appears
   when the button is pressed - announced without stealing focus, applied only on request.
2. **The status chips read along the pipeline, and `converted` is the only filled chip anywhere in
   the app.** The five statuses are a progression, not five unrelated states, so `new` takes the
   signal colour (it is the one asking for attention) and `converted` is filled, so the outcome
   that matters is unmistakable when scanning a long list. Every chip still spells its status out,
   so colour reinforces rather than carries the meaning.
3. **The timeline gives submissions and activity two different weights.** A submission is a
   bordered panel because it is immutable evidence somebody sent; an activity entry is a hairline
   note because it is an annotation a teammate made. That is blueprint 4.6's distinction expressed
   as structure rather than as a legend, and reading down the spine tells you which marks came from
   outside and which came from your own team.
4. **The conflict is a designed state, not an error banner.** A stale canonical save says what
   happened - "This lead changed while you were editing" - names both causes (a teammate, or the
   visitor submitting again), and offers the one action that resolves it. Telling somebody
   "conflict" and leaving their typing in a box that will not save is a dead end.
5. **Merge is an inline panel, not a modal.** This app has deliberately avoided composite widgets
   in favour of native elements, and a modal is the one that most often ships with broken focus
   handling. The inline panel needs none of that machinery and keeps both leads visible while the
   choice is made. It also states that the merge cannot be undone BEFORE it happens.
6. **Export sits beside the filter disclosure, not inside it.** Blueprint 4.7 exports what the
   filter is showing, so the download control belongs next to the control that narrows the list -
   and next to the "N active" badge, which is what tells somebody the list is narrowed at the exact
   moment they decide to download it. It is a real `<a href>` rather than a fetch, so the streamed
   attachment stays out of memory and keeps the filename the server sets.
7. **`EventSource`, not a hand-rolled fetch stream.** It gets two of blueprint 13.1's requirements
   for free and correctly: it remembers the last `id:` and sends it back as `Last-Event-ID` on
   reconnect, and it applies the `retry:` interval the server sets, so the ordinary reconnect delay
   is one server decision rather than each client's invention. What it does not do is give up, so
   the hook adds one layer: a CLOSED socket reopens with a delay that doubles to a 30-second cap and
   stops after six attempts. Without that cap a revoked member's browser would loop forever against
   an endpoint that will never accept it again.
8. **A refused control is absent, not disabled.** A Member has no export button, no trash link, no
   merge button, and no canonical-edit panel. Same treatment the audit-log link already gets.

### Where AI failed or was corrected

- **Export was unreachable, and the browser test is what said so.** I had put it inside the filter
  disclosure, which is collapsed by default - so an Owner looking for it would not have found it.
  `toBeVisible()` failed, and the honest fix was a design fix rather than opening the panel in the
  test. It now sits beside the disclosure, always visible.
- **I overclaimed the row design in my own comment.** I had written that "every row carries where
  the lead came from", which is the idea I wanted; the screenshot showed the row carries a
  submission count and a date, because the list summary the API returns has no source field.
  Corrected the comment to describe what the row does and where full provenance actually lives -
  the detail timeline, which does carry the page each submission arrived from.
- **A reserved-height live region left a hole in the layout.** `min-h-9` on the arrival region kept
  space for a button that is usually absent, which read as an unexplained gap above the list. A
  live region has to exist in the DOM to announce reliably; it does not have to reserve space.
- **`reuseExistingServer` bit twice, in opposite directions.** First, every submission in the
  opening E2E run failed with a 404 whose body was the app's catch-all message rather than the
  submission service's: the long-running dev server predated Stage 7's submit route and had been
  kept alive across stages. Worth keeping on its own - read the error BODY, not just the status;
  the two 404s meant completely different things. Later, a suite run failed from test 19 onward
  with uniform ~12-second failures across specs I had not touched, including ones that had just
  passed. The API server had died mid-run: it was a `webServer` child of an EARLIER Playwright
  process, this run adopted it because its health check answered, and it went away when its real
  owner was reaped. The lesson is the same hazard from the other side - a suite that reuses a
  server it does not own can be handed a stale one or lose a live one, and neither failure looks
  like what it is. `curl /health/live` distinguished them in seconds.
- **A flaky exit-gate test turned out to be a real product bug.** The Member journey failed roughly
  one run in three, and only in a multi-file run - the pattern Stage 6 taught me not to dismiss as
  contention. The bulk bar simply was not there after a row was checked, which meant the selection
  had been cleared. `load()` ended with `setSelected(new Set())`, and React StrictMode runs the
  mount effect twice in development, so the second load's completion erased a selection made
  between the two. The defect is not the double-invoke: it is that ANY refresh silently discarded
  a selection the person had just made, with no explanation, and Stages 9 and 10 add more refresh
  triggers. The list now PRUNES the selection to the rows still present instead of clearing it,
  which keeps the guarantee that mattered - a bulk action can never target a row that is gone -
  and lets somebody apply a second action to the same set.
- **Three test-side locator mistakes, each pointing at something real.** `getByLabel('Search')` also
  matched the "Select <name>" row checkboxes, because `getByLabel` is a substring match.
  `getByRole('status')` was ambiguous because the arrival live region is a permanent second status
  region. And the status chip testid appears in both a row and the filter panel. All three were
  fixed in the tests, but each is a reminder that a `<details>` panel's contents stay in the DOM
  while collapsed.
- **`typescript-lsp` went stale twice**, once reporting line numbers from before an edit and once
  omitting a component that had just been added. Same workaround as previous stages: kill the
  language server, let it respawn, re-run. `tsc` stayed the authority while editing.

### Verification performed

```
npm run lint               exit 0
npm run format:check       All matched files use Prettier code style!
npm run typecheck          exit 0
npm run build              exit 0
npm test                   Test Files 12 passed (12)   Tests 238 passed (238)
npm run test:integration   Test Files 10 passed (10)   Tests 209 passed (209)
npm run test:e2e           88 tests passed (16 new)
```

### Plugin usage this stage

- **`frontend-design` - used substantively, as the stage brief asked.** It set the working method:
  plan tokens and layout first, then check the plan against the brief for anything that reads as a
  default rather than a decision. The existing system fixed the palette and the type, so the design
  work went into structure, and the skill's "structure is information" principle is what produced
  the two-weight timeline - submissions and activity look different because blueprint 4.6 says they
  ARE different, not for variety. Its restraint prompt is what cut a per-row hover action cluster:
  it duplicated the bulk bar and the detail page, and hover-only affordances are bad for keyboard
  and touch. The one deliberate risk it pushed for is the filled `converted` chip - the only filled
  chip in the app.
- **`typescript-lsp` - worked.** Used for navigation across three new pages and for a clean
  diagnostics pass; went stale twice and was restarted, after which document symbols matched disk
  exactly.
- **`context7` - not consulted.** The stage brief said to use it only if a genuine question arose.
  None did: the SSE client question resolved to "use the platform's own EventSource", and the rest
  was this repository's existing conventions.

### Open questions for a human

1. **Nothing consumes the outbox.** A lead reaches the inbox live, but no email or webhook is sent
   (Stage 9).
2. **The widget's form still does not post.** Everything downstream of the submission endpoint is
   real and tested; the visitor's keystrokes are the one unwired part. It is a small change and
   belongs with the runtime.
3. **The E2E database has never had migrations applied.** `npm run migrate` against
   `leadcapture_e2e` fails on duplicate membership data left by earlier runs. The suite passes
   because MongoDB creates collections implicitly, but that database runs without its unique
   indexes, so it is a weaker environment than production. Pre-existing rather than introduced
   here; it wants a deliberate reset, which is not mine to do unasked.
4. **Live updates carry contact events only**, and membership revocation closes a stream within one
   25-second heartbeat rather than instantly.
5. **Nine filter dimensions is a lot of interface** for a portfolio demo, and I have no usage data
   to say which ones earn their place. They are behind a disclosure, so they cost nothing until
   opened, but a real product would cut most of them.
6. **CI has still never run**, because no remote is configured.

---

## Stage 9 - Reliable email, webhooks, and delivery operations (2026-08-29)

**Assistant:** Claude Opus 5, via Claude Code.
**Scope authorized:** Blueprint Stage 9, complete.

### What was done

- `packages/database`: `Delivery`, `WebhookEndpoint`, and `NotificationRecipient` records with their
  repositories, delivery settings on the Widget record, and migration `008_delivery`.
- `packages/contracts`: the delivery health, webhook, recipient, and template contracts.
- `apps/server/src/domain/delivery/`: retry classification and backoff, idempotency keys, template
  allowlisting, SSRF destination validation, and HMAC signing - all pure.
- `apps/server/src/infrastructure/queue/`: four BullMQ queue families and a worker factory.
- `apps/server/src/infrastructure/webhook/`: the SSRF-safe HTTP client.
- `apps/server/src/application/delivery/`: the delivery engine, the admin/settings service, the
  outbox reconciler, and the worker's outcome translation.
- `apps/web/src/pages/DeliveryPage.tsx`: the workspace delivery health view.

### Key decisions

1. **The queue moves work; Mongo holds the truth.** A `Delivery` document records what was promised,
   every attempt, and what may be replayed. BullMQ is the mechanism that moves it along. Putting the
   record in Redis would have been less code and quietly wrong: a queue is a work list, and flushing
   it must not erase the fact that a notification was owed.
2. **Four queues, not one with a `type` field.** A webhook talks to an arbitrary internet host and
   wants low concurrency and a long timeout; email talks to one provider under a daily budget. One
   queue would let a slow receiver stall the notification emails queued behind it.
3. **Permanent failures throw `UnrecoverableError`.** BullMQ documents it as moving a job straight to
   the failed set regardless of `attempts`, which is exactly blueprint 12.2's "only transient
   failures retry" expressed at the queue boundary rather than defended by a counter.
4. **A budget deferral is not a failure and does not consume an attempt.** Blueprint 5.3 says excess
   non-critical mail "remains queued until the next provider allowance window". Treating it as a
   failure would spend the five-attempt budget on a policy decision and dead-letter mail that was
   never broken.
5. **`failed` and `dead_letter` are separate states.** A permanent rejection was final on attempt
   one; a dead letter exhausted five transient attempts and might succeed now. Only the second is
   replayable, and collapsing them would make the replay button meaningless on half the rows it
   appeared on.
6. **SSRF is checked before EVERY request, not only at save.** 12.4 says destinations are blocked,
   not that they are blocked once, and a hostname that resolved publicly last week can resolve to
   169.254.169.254 today. Every resolved address is checked rather than the first, and IPv4-mapped
   IPv6 is decomposed - `::ffff:127.0.0.1` is IPv6 syntactically and loopback in effect.
7. **Redirects are disabled rather than revalidated.** 12.4 allows either. Disabling has no bypass:
   a public URL cannot bounce the request to an internal one.
8. **The signature covers `timestamp.body`.** A signature over the body alone is replayable forever;
   binding the timestamp is what lets a receiver reject an old capture, and it is the convention
   Stripe and GitHub both settled on for the same reason.
9. **Rotation sends BOTH signatures for 24 hours.** Without an overlap, rotating means a guaranteed
   dropped payload for every receiver not watching at that instant.
10. **An external recipient must confirm their address.** A workspace member already proved theirs to
    join. Any other address gets a hashed expiring token, because otherwise the settings form is a
    way to point somebody else's leads at any address an attacker typed.
11. **Reconciliation is a sweep, not a listener.** A listener has to be told about the failure, and
    the failure case is precisely the one where telling anything is unreliable.

### Where AI failed or was corrected

- **The replay was broken, and only the replay.** I recovered the webhook endpoint id by parsing it
  out of the idempotency key - which works for an original delivery (`hook:<submission>:<endpoint>`)
  and silently breaks for a replay, whose key has a different shape. The replay failed with "unknown
  endpoint" instead of retrying, so the one feature the operator presses a button for was the one
  that did not work. The endpoint id is now stored on the record. Deriving a foreign key by string
  surgery was the mistake; the key format changing underneath it was inevitable.
- **Two Stage 7 tests broke, correctly.** They asserted the outbox row stays `pending`, which was
  true only while nothing consumed it. Stage 9 is that consumer. I updated the assertions to the new
  truth - the row is written in the same commit and now settles - rather than weakening them, and
  said so in the test.
- **BullMQ 6 changed the repeatable-job API underneath me.** `add(..., { repeat })` is gone in favour
  of `upsertJobScheduler`. Caught by `tsc`, not by reading; worth noting that the upsert is also the
  behaviour I wanted, since restarting the process replaces the schedule rather than adding a second.
- **I wrote a circular dependency into the composition root** - the reconciler needs the workers'
  `enqueue`, and the sweep worker needs the reconciler - and reached for a cast to paper over it.
  That was wrong twice: the cast set a property the class never read, so the sweep would have thrown
  at runtime. Fixed by inverting it: the reconciler is a parameter to `start()`, so neither object
  is ever half-built.
- **My own port allowlist failed my own test.** The local webhook receiver bound to an ephemeral
  port, which the SSRF check refuses - the allowlist working exactly as designed, against me. The
  receiver now binds 8080. Worth keeping: a security control that is inconvenient in a test is
  usually inconvenient in production too, and that is the moment to decide deliberately rather than
  to widen it.

### Verification performed

```
npm run lint               exit 0
npm run format:check       All matched files use Prettier code style!
npm run typecheck          exit 0
npm run build              exit 0
npm test                   Test Files 13 passed (13)   Tests 291 passed (291)
npm run test:integration   Test Files 11 passed (11)   Tests 240 passed (240)
npm run migrate            applied 1, skipped 7
```

Browser E2E is not required by this stage's gate, but the delivery link changed the workspace
navigation, so the full suite was re-run and two accessibility tests were added for the new page.

### The E2E database gap, closed

Stage 8b recorded that `leadcapture_e2e` had never had migrations applied - 20 duplicate membership
pairs from earlier runs blocked migration 001, and MongoDB's implicit collection creation had been
hiding it. I asked before touching it, because dropping a database is not mine to decide. With
explicit authorization the database was dropped and re-migrated: **applied 7, skipped 0**. That
environment now matches production index-for-index, including the unique constraints it had been
running without.

### Plugin usage this stage

- **`context7` - three consultations, all load-bearing.** BullMQ's own source and docs established
  three things I would otherwise have got wrong: `UnrecoverableError` is the documented way to stop
  retrying a permanent failure; `backoff: { type: 'exponential', jitter }` is native, so the queue
  and the reconciler share two constants instead of two hand-rolled schedules; and **BullMQ has no
  built-in dead-letter queue** - a job that exhausts its attempts simply lands in the failed set and
  emits `retries-exhausted`. That last point is why the dead-letter state is a field on the Delivery
  record rather than a queue I assumed existed. Node's DNS and fetch docs confirmed
  `lookup(host, { all: true })` for checking every resolved address and that `redirect: 'manual'`
  returns the real response under undici, so a 3xx can be inspected and refused.
- **`frontend-design` - used substantively for the delivery health view.** Its "structure is
  information" principle produced the page's signature: five attempts is a genuinely finite,
  countable budget, which is the one place in this product where a numbered sequence is the content
  rather than decoration, so it is drawn as five slots - filled for spent, struck through for the
  attempts a permanent rejection means will never be spent. Its restraint prompt is what stopped me
  adding a second filled chip: `converted` in the contact inbox is the only filled chip in the app,
  and a dead letter is already distinguished three ways without borrowing that. The budget meter is
  segmented rather than a single bar because the allowance has structure - 100 of the 300 are
  reserved for auth mail - and one bar would have misrepresented the policy.
- **`typescript-lsp` - worked.** Used for navigation across the new delivery modules and for a clean
  diagnostics pass; document symbols matched disk exactly on the final check.

### Open questions for a human

1. **The operator alert only writes a log.** `delivery.dead_letter_alert` is a structured error
   record with the actor-safe fields; a pager or email integration attaches at that one call site.
2. **The reconciliation sweep needs the worker running.** In production it starts in-process per
   blueprint 12.1. The tests deliberately do not start it, so nothing in CI proves the schedule
   itself fires - only that the sweep does the right thing when called.
3. **SSRF validation is check-then-connect.** A DNS entry that changes between the two is not
   caught. Closing it properly means pinning the connection to the validated address, which Node's
   fetch does not expose. The port allowlist limits what a won race could reach, and the limitation
   is stated in the code rather than hidden.
4. **Brevo has never been exercised for real.** Every email in every test goes to Mailpit. The
   adapter's failure classification is unit-tested, but no message has been sent through the actual
   provider, and the free tier's 300/day is a real constraint a busy demo would hit.
5. **Nothing purges delivery rows early.** The 90-day TTL index handles retention, but a workspace
   deleted tomorrow leaves its delivery history until the TTL catches up (Stage 11).
6. **CI has still never run**, because no remote is configured.

---

## Stage 10a - Interaction-event ingestion, aggregation, and live-update backend (2026-08-29)

**Assistant:** Claude Opus 5, via Claude Code.
**Scope authorized:** Blueprint Stage 10, sub-stage 10a of 2. Backend only - no dashboards, which
are 10b. Stage 10 stays open on the checklist.

### What was done

- `packages/database`: `InteractionEvent` and `DailyAnalytics` records with their repositories, and
  migration `009_analytics`.
- `packages/contracts`: the event batch schema, the aggregate DTOs 10b will consume, and the two new
  SSE payload shapes.
- `apps/server/src/domain/analytics/`: the five funnel formulas and the rotating visitor pseudonym -
  both pure.
- `apps/server/src/application/analytics/`: ingestion, aggregation, and the retention sweep.
- `POST /widget/v1/events/:publicId` with CORS preflight, on the Stage 7 hardening pattern.
- `packages/widget-runtime`: funnel instrumentation at the five lifecycle points.
- `usage.changed` and `delivery.status_changed` added to the Stage 8a hub, completing 13.1.
- Both monthly meters, which had reported `null` since Stage 4a, now count for real.

### Key decisions

1. **Expiry is a sweep with a precondition, not a TTL index.** Blueprint 9.2 describes the raw
   events as having "automatic expiry after 90 days", which reads like a TTL. 4.9 is more specific:
   they are "removed after daily aggregates are produced". A TTL deletes on a clock alone and cannot
   check that, so a week of failed aggregation would become a week of destroyed data. The sweep
   aggregates first, confirms the aggregate exists, and refuses the day otherwise. This is the one
   place I read two blueprint sections as being in tension and followed the more specific one.
2. **Aggregation recomputes and upserts rather than incrementing.** A retried BullMQ job and an
   operator re-running a day are both ordinary; an increment-based aggregator would corrupt a
   workspace's history on either. Recompute-and-upsert onto the unique key makes running it three
   times produce the same numbers, which a test asserts directly.
3. **`localDay` is stored at write time, not derived at aggregation time.** A workspace in Auckland
   and one in Los Angeles disagree about which day an instant falls in, and recomputing that during
   a sweep would mean re-reading every workspace's timezone for every event. Fixing it at ingest
   also means a workspace that later changes its timezone does not silently rewrite its own history.
4. **A zero denominator is `null`, never `0`.** A rate of 0 asserts "people saw it and nobody
   acted"; a day with no impressions supports no such claim. Returning 0 would make an untouched
   widget look like a failing one and drag any average that included it downward. 10b has to render
   "no data" because the type gives it no choice.
5. **Ranges sum counts before dividing, never average rates.** Averaging four days of percentages
   gives a quiet Sunday with one impression the same weight as a Monday with a thousand. A test
   contrasts the two answers - 0.55 against 0.10 for the same data - so the reason is on record.
6. **The visitor pseudonym is domain-separated AND per widget.** Both pseudonyms derive from the
   same secret and the same address; without a distinct subkey label they would be identical
   strings, and joining the analytics and abuse collections would reunite "who browsed" with "who
   was rate limited". The widget id goes inside the HMAC so one visitor does not carry a single
   identifier across every customer's site - blueprint 21 asks for that by name.
7. **The server timestamps every event.** `observedAt` from the client is advisory and unused. A
   client clock would let a caller backdate events into a day that has already been aggregated and
   expired, which is both a correctness hole and a way to write rows the sweep has already passed.
8. **The endpoint answers a uniform 202.** Unknown widget, unpublished widget, disallowed Origin,
   over quota, and throttled all look identical. A widget has nothing useful to do with the
   difference, and distinguishing them would make a public id a widget-enumeration oracle. A
   malformed BATCH is the one exception and returns 400, because that is a caller's bug rather than
   a limit and a silent 202 would hide it from whoever has to fix it.
9. **`usage.changed` fires per submission but only per hundred interaction events.** 2,000 a month
   is a bounded number somebody watching their quota wants to see move; 20,000 is not, and
   broadcasting each one would spend Redis commands and browser wake-ups on a number changing by
   one. The boundary check costs nothing because both figures are already in hand.
10. **Open-eligibility is read from the published config, not the widget type.** An inline form is
    permanently visible and has no open action, so its impressions must stay out of the open-rate
    denominator - but a contact form in `modal` mode genuinely opens. Inferring from type alone
    would have reported every modal form's open rate as "no data".

### Where AI failed or was corrected

- **I nearly shipped a TTL index.** My first migration had `expireAfterSeconds` on
  `interaction_events`, straight from 9.2's wording, which would have deleted raw events on a
  schedule with no regard for whether they had been aggregated. Caught while writing the retention
  test, when the assertion I wanted to make - "the aggregate survives" - turned out to be
  unprovable, because nothing guaranteed the aggregate existed first.
- **The MutableClock trap, again.** The expiry test aged events by `Date.now() - 91 days` while the
  service computes its cutoff from the injected clock, which sits a day behind the wall clock. The
  two landed hours either side of the boundary and the sweep correctly deleted nothing - a test
  failing for a reason unrelated to the rule it was checking. Stage 7 hit this exact shape. The test
  now measures from `harness.clock`.
- **A weak test I rewrote rather than kept.** My first attempt at the retention precondition tried
  to force aggregation to fail and ended up asserting a tautology. Aggregation cannot really fail
  for a day that has rows, so the honest test is the ORDER: a day reaching the cutoff with no
  aggregate must come out of the sweep with one carrying the right counts, which proves the raw
  events were read before they were removed.
- **My own arithmetic.** I asserted 9 raw events for four batches that contain 8.
- **A name collision in a dependency bag.** `events` was already the interaction-event repository
  when I added the SSE publisher under the same name; `tsc` caught it, but the fix was to rename
  rather than to nest, because two very different things called the same name in one object is how a
  wrong wiring survives review.
- **Two tests broke, correctly, and both for the same reason.** A Stage 4a integration test and a
  Stage 5b browser test each asserted that the monthly meters report "not counted yet" - the honest
  answer while the data behind them did not exist. Stage 10a measures them, so zero is now the
  truthful answer for an empty workspace. Both were updated to the new truth rather than weakened.
  The browser one also surfaced dead copy: the dashboard still carried "Counted once submissions
  exist" as its placeholder, which had gone from honest to false the moment the meter became real,
  so the fallback text was corrected too.

### Verification performed

```
npm run lint               exit 0
npm run format:check       All matched files use Prettier code style!
npm run typecheck          exit 0
npm run build              exit 0
npm test                   Test Files 14 passed (14)   Tests 317 passed (317)
npm run test:integration   Test Files 12 passed (12)   Tests 260 passed (260)
npm run migrate            applied 1, skipped 8
```

**The E2E database needed migrating too, and I forgot.** `npm run migrate` targets the development
database; `leadcapture_e2e` is a separate one, and it was still at 007 while the code assumed 009. A
browser run failed once at widget publish with a server-side `MongoServerError`, the E2E database
turned out to be two migrations behind, and the test passed after applying them
(`applied 2, skipped 7`). I could not reproduce the failure afterwards, so I cannot state with
certainty that the missing indexes caused it - only that the gap was real, that it is now closed,
and that a stale test database is exactly the kind of thing that produces an unreproducible failure.
Stage 8b found the same environment behind in a different way; the pattern is that a new migration
needs applying to BOTH databases, and nothing currently enforces that.

The widget runtime changed, so the browser suite was re-run even though this sub-stage's gate does
not require it. The runtime bundle grew from 13.6 KB to 15.1 KB raw (5.5 KB to 6.0 KB gzipped),
still inside the 20 KB / 8 KB budgets blueprint 8.3 sets.

### Plugin usage this stage

- **`typescript-lsp` - worked.** Used for navigation across the new analytics modules and for a
  clean diagnostics pass; document symbols matched disk exactly on the final check. No staleness
  this time.
- **`context7` - not consulted.** The stage brief said to use it for BullMQ or Redis API questions
  "if they arise". None did: Stage 9 had already established `upsertJobScheduler` as the current
  scheduling API and the pub/sub subscriber-connection rule, and this stage reused both patterns
  unchanged rather than meeting anything new.
- **`frontend-design` - confirmed available, deliberately not invoked.** There is no UI in this
  sub-stage. It was used substantively in Stages 8b and 9, so its availability is not in question;
  inventing a UI change to justify calling it is exactly what the brief said not to do.

### Open questions for a human

1. **Geo slices are empty for interaction events.** The country and city dimensions are computed and
   indexed, but the ingest path calls no geo provider: 20,000 events a month per workspace would
   exhaust ip-api's free tier on telemetry alone. Those slices are populated from submissions today,
   which is the smaller and more valuable set.
2. **`status conversion` has no inputs yet.** The formula is implemented and unit-tested; computing
   the cohort from Contact status is 10b's work when it renders the metric.
3. **The `submission` funnel event fires at the runtime's form seam**, which still does not post a
   real submission. It records the visitor reaching the stage rather than an accepted lead, and the
   two will only agree once that seam is wired.
4. **Nothing proves the hourly schedule fires.** The sweep is a BullMQ job scheduler registered when
   workers start in-process; the tests call it directly for determinism.
5. **The distinct-visitor count is per day, per slice.** Rolling a week's `visitors` into a single
   figure would double-count somebody who returned - the aggregate keeps a count rather than the
   pseudonyms, deliberately, so a weekly unique-visitor number is not derivable and should not be
   presented as one in 10b.
6. **CI has still never run**, because no remote is configured.

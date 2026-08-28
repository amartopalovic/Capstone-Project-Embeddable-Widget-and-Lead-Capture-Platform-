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

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

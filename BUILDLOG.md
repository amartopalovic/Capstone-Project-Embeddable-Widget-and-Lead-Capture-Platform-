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

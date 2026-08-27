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
   one section per acceptance probe from §18.5 *plus* placeholders for §4, §17, and §22. A flat list
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

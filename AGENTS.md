# Agent rules

This codebase is yours: what it's for and how it's built are your call, and you'll keep building on it.

Bun is the JavaScript runtime and package manager.

## Layout

One repository, one bun and one Cargo workspace (ADR 36). Apps live in `apps/`; each app's `AGENTS.md` holds what applies only to it, and wins inside it. Shared Rust lives in `crates/`, shared TypeScript in `packages/`. Home is `apps/home`.

## Specs

Specs are ADRs in `docs/adr/`, written by a `grilling` session. Domain terms live in `GLOSSARY.md`.
No code before the ADR that names it.

## Gate

`bun run gate` is the only check (ADR 13): every format, lint, type, build and test step, as a parallel DAG that stops at the first failure. A step, and each component test file, whose inputs hash as on its last green run is skipped; `GATE_FRESH=1` runs them all. Run it green before a branch merges into its milestone branch or `staging`. `bun run gate:pr` scopes cargo and component tests to what the diff since `staging` reaches.

The pre-commit hook runs `bun run hook` (`scripts/hook.ts`): format and lint of the staged files, types, the bun tests the staged files reach and `cargo test` of the staged crates. A green hook is not a green gate.

## TDD

Load the `tdd` skill before any behaviour change. Behaviour ships with the test that proves it, written first: failing test, run it red, smallest code to green.
This code talks to grid-tied hardware. A red suite never leaves the machine.

## YAGNI

YAGNI governs features, not seams (ADR 1).

- **Seams** an ADR names are built now, with one adapter and a test through the interface.
- **A missing seam** is one whose late arrival would migrate stored data, break a published contract (API, profile schema, file format) or touch every adapter. Build it now, and record it in the ADR it belongs to in the same change.
- **Features** serve the current task. Options, flags and abstractions wait for their second real use.
- Delete unused code.

## Skills

Project skills live in `.agents/skills/`. Load each at its trigger:

- `grilling`: a new ADR. `domain-modeling`: an ADR amendment or a glossary term.
- `codebase-design`: a module's interface or a seam.
- `diagnosing-bugs`: a bug, or a red gate you did not cause.
- `svelte-code-writer` and `svelte-core-bestpractices`: any `.svelte` or `.svelte.ts` file.
- `code-review`: before a branch merges. `pr`: a PR body.

Issues live on GitHub: `docs/agents/issue-tracker.md`.

## Prose

Minimum words. Code comments carry only the why or a constraint. Reports: findings first, one line each, end with `Recommendation:` and one concrete next action, or `none`.

## Commits

Conventional commits, lowercase types: `type(scope): summary`. One logical change per commit.

## Branches

`staging` is the only working line, always green; `master` keeps the v4 history and takes no merges. ADRs change with the code they govern; a new ADR lands on `staging` before its milestone starts.

- **Milestone:** branch `m/<milestone-slug>` from `staging`. It merges into `staging` as one merge commit once its tickets are closed and the `code-review` skill has passed.
- **Ticket:** branch from the milestone branch, in its own worktree, and merge back into the milestone branch.
- **Cleanup:** remove a ticket's worktree and branch as soon as it merges, and the milestone branch once it is in `staging`. Run `cargo clean` in any worktree before removing it. `git worktree list` shows only worktrees with work in progress.

# Agent rules

This codebase is yours: what it's for and how it's built are your call, and you'll keep building on it.

Bun is the JavaScript runtime and package manager.

## Specs

Specs are ADRs in `docs/adr/`, written by a `grilling` session. Domain terms live in `GLOSSARY.md`.
No code before the ADR that names it.

## Gate

`bun run gate` is the only check (ADR 13): every format, lint, type, build and test step, serially, stopping at the first failure. The pre-commit hook runs it.

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

`v5` is the only main line, always green. ADRs change with the code they govern; a new ADR lands on `v5` before its milestone starts.

- **Milestone:** branch `m/<milestone-slug>` from `v5`. It merges into `v5` as one merge commit once its tickets are closed and the `code-review` skill has passed.
- **Ticket:** branch from the milestone branch, in its own worktree, and merge back into the milestone branch.
- **Cleanup:** remove a ticket's worktree and branch as soon as it merges, and the milestone branch once it is in `v5`. Run `cargo clean` in any worktree before removing it. `git worktree list` shows only worktrees with work in progress.

---
name: factory-implementer
description: Build one ticket or fix one PR inside its assigned factory slot.
model: sonnet
effort: high
maxTurns: 250
disallowedTools: Agent
skills:
  - tdd
  - pr
color: blue
---

The prompt supplies slot JSON (`path`, `env`, `branch`, `issue`, and in fix mode `pr` and `reviews`). Run shell commands as `cd <path> && . <env> && <command>`. Factory owns worktrees and cleanup.

1. Read `scripts/factory/factory config`; use its `base` for every fetch, diff, merge and PR. Read the ticket, cited specs, root `AGENTS.md`, and every applicable area guide. In fix mode read all supplied reviews. Done when every acceptance criterion or finding has a test seam.
2. In fix mode, when the branch conflicts or a review requests it, fetch and merge `origin/<base>` with subject `chore: merge <base> into <branch>`. Resolve by intent; regenerate configured artifacts via `scripts/factory/factory regenerate`. Follow area instructions for migrations and other generated files. Contradictory requirements go to a person.
3. Work test-first with the `tdd` skill under the repository's TDD rules: write the failing test, run it red, then implement. Run focused tests while iterating and every layer required by the changed behavior. Use the repo's own test commands and conventions. Expected values come from independent examples or cited fixtures. Every boundary the ticket or `AGENTS.md` names gets a test that goes red when its bound moves: flip each bound once before the PR. Done when every criterion has executable proof.
4. Hold the turn open until the gate exits: run `scripts/factory/factory gate --detach` on the final tree, then loop `scripts/factory/factory gate-wait` (foreground, tool timeout 600000) until it prints an exit code; stay silent meanwhile, your next message is the result line. Also run the area-specific checks root and area guides require. A failed, skipped or unavailable required check is unresolved; report it rather than calling the gate green. Database and route tests use only the repository's scratch harnesses; coordinate shared test resources across slots. Never connect development servers or factory tests to live hardware.
5. Commit using conventional commits, then push normally to the explicit `factory/*` branch. Open the PR against the configured base with `gh pr create --base <base> --head <branch> --body-file <file>`; fix rounds update the existing PR. Use the `pr` skill for the body. Check size against config's `max_pr_files` and `max_pr_lines`; oversized work goes to splitting with commits pushed.

Result line only after the gate exited. Stop every other background task you started before reporting.

Write at most 12 lines. Line 1 is exactly one result line below; then only facts the dispatcher must act on; last line is `Recommendation:` with one concrete next action, or `none`.

- `RESULT pr=<number>`: PR opened or updated, required local gates green.
- `RESULT failed: split needed — <why>`: ticket cannot fit a session or configured size limits.
- `RESULT failed: <reason>`: stopped, with the failing command.
- `RESULT human: <question>`: decision or missing prerequisite only a person can supply.

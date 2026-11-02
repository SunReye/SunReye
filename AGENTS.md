# Monorepo Agent Routing

**This project uses [bun](https://bun.sh/) as JavaScript runtime + package manager.**

Keep this root `AGENTS.md` routing-only.

Every `AGENTS.md` holds routing and rules only: no per-feature notes, route or endpoint catalogs, or
layout tables. The code, `GLOSSARY.md` and `docs/adr/` carry feature detail.

## TDD is mandatory

This code writes registers on grid-tied inverters and batteries. Behaviour ships with the
test that proves it, written first:

1. Write the failing test. 2. Run it, see it fail. 3. Write the smallest code that turns it
green.

- Never write implementation before the test that names the behaviour.
- Never mark work done on an unrun suite: `bun run test` (whole repo, seconds).
- A commit is blocked by a red suite; a merge is blocked when source changed and no test did
  (`scripts/ci` step "tests required") or when coverage falls (`scripts/coverage-floor.ts`).
  Exemptions live in `scripts/require-tests.ts` and are themselves tested. There is no skip flag.
- Cover boundaries, not just the happy path: zero and negative values, absent and empty
  payloads, stale readings across midnight, partial windows, counter restarts.
- If logic is hard to test because it lives inside a component, extract it. That extraction
  is part of the change, not a follow-up.

### Pick the layer

| Behaviour | Test | Run |
| --- | --- | --- |
| Logic, one module | `*.test.ts` beside the source | `bun run test` |
| What ONE component renders or how it reacts | `apps/web/src/**/*.svelte.test.ts` (Vitest browser mode, Chromium; runes run only here) | `bun run test:components` |
| Only exists in a running app: reactive loop, request storm, journey across pages | `apps/web/e2e/*.spec.ts`; counts as "a test changed" | `bun run e2e` (named specs) |
| Postgres accepts the statement: Timescale hyperfunction, continuous aggregate, `UNION`, `DISTINCT ON`, cast | `apps/server/db-tests/*.test.ts`; a SQL-text assertion proves nothing | `bun run test:db` |
| A route answers, and refuses who it should | route smoke | `bun run test:routes` |

- A source-text regex over the fix's own text is never a test (`apps/web/TESTING.md`, "Three layers").
- `test:db` passes `--timeout 60000`: add no per-test budgets to chase a flake. It creates and drops
  its own `sunreye_dbtest` database and refuses any other name, because `DATABASE_URL` may point
  at a database shared with a live inverter. It skips without Postgres and fails hard when `CI` is set.
- `test:routes` starts a throwaway TimescaleDB on 5433 (never 5432), boots the server with
  `INVERTER_SIMULATE=true`, and hits every route in the OpenAPI listing: a 5xx or dead connection
  fails, a 4xx passes. A no-credentials sweep requires everything outside `PUBLIC_LABELS`
  (`scripts/route-smoke-plan.ts`) to refuse; a non-admin sweep requires every `SESSION_LABELS`
  route reachable and the rest refused; `/ws` is probed all three ways. A write answered 422 is
  reported UNPROVEN and fails: validation runs before the guard. Run it for route-layer work.
- `mock.module` is process-global and permanent. Spread the real module, and restore a first-party
  mock in `afterAll` from a by-value snapshot of its exports (a namespace is live, so
  `() => real` restores the stub). `bun run test:mocks` enforces both and is the only catch for a
  missing restore, because `bun run test` passes `--parallel` (fresh module registry per file).
  Never `--no-isolate`.
- `bun run test:coverage` stays serial: bun's parallel coverage merge is lossy and fails
  `test:floor` for reasons unrelated to the code. Never add `--parallel` there.

Rationale and examples: `CONTRIBUTING.md` §6 and §7. Frontend: `apps/web/TESTING.md`.

Load `caveman` skill at start of every session.

Repo-local skills live in `.agents/skills/`; `.claude/skills/` is where Claude Code resolves them
and links to the same directories, so add a skill in `.agents/skills/<name>/SKILL.md` and symlink it
in (`ln -s ../../.agents/skills/<name> .claude/skills/<name>`) — two copies drift.

Load the relevant one when matching work:

- Any `.svelte` file in `apps/web` (page, card, grid, chart box, live reading) → load
  `layout-system`. The skill holds the layout vocabulary; component tests hold what it renders.

## YAGNI

- Build what the current task needs. No speculative options, extension points, config flags, generic
  layers, or "for later" code.
- No abstraction until the second real use. Delete unused code instead of keeping it around.
- A spec item not yet scheduled is not a reason to add code now.

## Prose: docs, diagnostics, UI copy, code comments, reports

- Minimum words. No subtext, no restating what the name or code already says, no reassurance or
  marketing tone.
- Diagnostics and CLI output: name the location and the fix; no apology, no filler.
- UI copy: label over sentence; descriptions only when they add a fact or next step.
- Code comments: only the why, a constraint, or a non-obvious invariant. One line where possible. No
  narrating the code, no history ("was", "now", "changed from").
- Reports, PR bodies and agent replies: findings first, one line each; end with `Recommendation:` and
  one concrete next action, or `none`. No preamble, no recap.
- When in doubt, delete the string or comment.

## Fallow

Dead code, duplication and code health: `bunx fallow` from repo root (`--format json` for agents).
Docs index: `https://docs.fallow.tools/llms.txt`.

## Area routing

- Agent factory (`/loop /factory`, `scripts/factory`, `.claude/agents/factory-*`) → `docs/factory.md`.
- `apps/web` → `apps/web/AGENTS.md`.
- `nixos/` → `nixos/README.md` first. `bun run test` does not cover it: the gate is
  `nix flake check ./nixos` and the boot test in CI. The `sunreye-setup` CLI is NOT in `nixos/`:
  its source is `apps/appliance-cli/src`, so the TDD rule above applies to it in full.
- Env vars, anywhere → `packages/env/AGENTS.md` first. Env schemas live only in `packages/env`.
- `packages/config` → `packages/config/AGENTS.md`.
- Task spans several areas → read and apply each. The more specific file wins.

## Branching & CI

- 4.0 work lands on `v4` (spec #302): open PRs into `v4`. `dev` takes 3.x fixes only.
- No hosted CI: `scripts/ci` is the merge gate, run locally; `scripts/ci --e2e` adds the browser suite.
  Workflows run only on manual dispatch. Do not add CI triggers without asking.

## Commit style

- Conventional commits, lowercase types: `type(scope): summary` (`feat`, `fix`, `refactor`, `docs`, `test`, `chore`).
- Subject imperative and specific; explain why in the body when not obvious.
- One commit = one logical change: no refactor + feature + formatting mix.
- Run the checks for the changed area before committing.

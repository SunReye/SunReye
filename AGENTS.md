# Monorepo Agent Routing

**This project uses [bun](https://bun.sh/) as JavaScript runtime + package manager.**

Keep this root `AGENTS.md` routing-only.

## TDD is mandatory

This code writes registers on grid-tied inverters and batteries. Behaviour ships with the
test that proves it, written first:

1. Write the failing test. 2. Run it, see it fail. 3. Write the smallest code that turns it
green.

- Never write implementation before the test that names the behaviour.
- Never mark work done on an unrun suite: `bun run test` (whole repo, seconds).
- A commit is blocked by a red suite; a PR is blocked when source changed and no test did
  (CI job **Tests required**) or when coverage falls (`scripts/coverage-floor.ts`).
- Cover boundaries, not just the happy path: zero and negative values, absent and empty
  payloads, stale readings across midnight, partial windows, counter restarts.
- If logic is hard to test because it lives inside a component, extract it. That extraction
  is part of the change, not a follow-up.
- When the behaviour only exists in a running document (a reactive loop, a request storm, an
  animation), the test is a browser spec: `apps/web/e2e/*.spec.ts`, `bun run e2e`. Those count
  as "a test changed" for the gate. Never stand a source-text regex over the fix's own text in
  for one — see `apps/web/TESTING.md`, "Which layer does this test belong in".
- When the behaviour is whether **Postgres accepts the statement**, the test is a database
  spec: `apps/server/db-tests/*.test.ts`, `bun run test:db`. A SQL-text assertion cannot
  prove a query runs — two 500s shipped behind a fully green suite that way (an ambiguous
  `time_bucket` overload, an `ORDER BY` that bound to a UNION instead of its arm). Anything
  touching a Timescale hyperfunction, a continuous aggregate, a UNION, `DISTINCT ON`, or a
  cast belongs here as well as in the unit suite. The layer creates and drops its own
  `sunreye_dbtest` database and refuses any other name — your `DATABASE_URL` may point at a
  database shared with a live inverter. It skips when no Postgres is reachable and fails hard
  when `CI` is set, so it can never be silently absent. Lives outside `src/` so
  `bun run test` stays database-free.
- Exemptions to the "a test changed with it" rule live in `scripts/require-tests.ts` and are
  themselves tested. There is no skip flag.
- `bun run test` passes `--parallel`, which gives every test file a fresh global
  and module registry. That contains the `mock.module` leak below **at runtime**:
  a missing restore no longer turns a later suite red. Measured on a two-file
  fixture — serial fails, `--isolate` and `--parallel` pass; `--no-isolate` fails
  again, so never reach for it. **The discipline below therefore still stands, and
  `bun run test:mocks` is now the only thing that catches a missing restore.** A
  leak that no run reveals is still a leak: it breaks anyone on `bun test` without
  the flag, on an older bun, or running one file at a time.
- `bun run test:coverage` stays **serial on purpose**. Bun's parallel coverage
  merge is lossy: identical passing tests report 88.91 % lines under `--parallel`
  against 99.31 % serial, reproducibly. Do not add `--parallel` there — it will
  fail `test:floor` for a reason that has nothing to do with the code.
- `mock.module` is process-global and permanent. ALWAYS spread the real module
  (`const real = await import("./x"); mock.module("./x", () => ({ ...real, stubbed }))`) —
  a partial mock deletes the other exports for every test file that runs afterwards and
  breaks them at import, order-dependently. Enforced by `bun run test:mocks`.
- ALWAYS restore a first-party mock too: a spread mock is still permanent, so the stub stays
  installed for every later file — and the suite that unit-tests that module then asserts
  against the double (red in the full run, green alone). Snapshot the exports BY VALUE at load
  time and hand them back: `const realX = await import("./x"); const realXExports = { ...realX };`
  … `afterAll(() => mock.module("./x", () => ({ ...realXExports })));`. A namespace is live, so
  `() => realX` restores the stub. Also enforced by `bun run test:mocks`.

Full rationale: `CONTRIBUTING.md` §6. Frontend specifics: `apps/web/TESTING.md`.

Load `caveman` skill at start of every session.

Repo-local skills live in `.agents/skills/`; `.claude/skills/` is where Claude Code resolves them
and links to the same directories, so add a skill in `.agents/skills/<name>/SKILL.md` and symlink it
in (`ln -s ../../.agents/skills/<name> .claude/skills/<name>`) — two copies drift.

Load the relevant one when matching work:

- TypeScript work → load `typescript-best-practices`.
- Tailwind class work → load `tailwind-best-practices`.
- SvelteKit work → load `sveltekit-best-practices`.
- Any `.svelte` file in `apps/web` (page, card, grid, chart box, live reading) → load
  `layout-system`. The layout vocabulary is test-enforced; the skill is the short version.
- AI SDK work → load `ai-sdk`.
- Starter repo initialization / post-clone customization → load `project-init`.
- Similar domain-specific work → load matching skill when available.

## Fallow

- Use Fallow for dead code, duplication, and code health checks.
- Start with `bunx fallow` from repo root.
- Common focused commands:
  - `bunx fallow dead-code`
  - `bunx fallow dupes`
  - `bunx fallow health`
  - `bunx fallow fix --dry-run`
- For agent workflows, prefer structured output with `--format json`.
- Before digging through Fallow docs, fetch `https://docs.fallow.tools/llms.txt` and use it as page index.

- Frontend work in `apps/web` → follow `apps/web/AGENTS.md`.
- Env var work anywhere → follow `packages/env/AGENTS.md` first.
- Env schemas live only in `packages/env`. Do not duplicate env parsing/validation inside apps or feature packages.
- Env package work in `packages/env` → follow `packages/env/AGENTS.md`.
- Shared config work in `packages/config` → follow `packages/config/AGENTS.md`.
- Task spans multiple areas → read + apply each relevant file. More specific package-level instructions win.

## Commit style

- Use conventional commits: `type(scope): summary`
- Keep subject imperative and specific
- Prefer lowercase types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`
- Scope when useful: `feat(web): add onboarding empty state`
- Keep subject tight. Explain why in body when not obvious
- One commit = one logical change. Do not mix refactor + feature + formatting noise
- Before commit, run checks relevant to changed area

Examples:

- `feat(web): add onboarding empty state`
- `fix(backend): prevent duplicate task creation`
- `docs: clarify post-clone setup`

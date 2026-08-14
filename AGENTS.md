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
- Exemptions to the "a test changed with it" rule live in `scripts/require-tests.ts` and are
  themselves tested. There is no skip flag.

Full rationale: `CONTRIBUTING.md` §6. Frontend specifics: `apps/web/TESTING.md`.

Load `caveman` skill at start of every session.

Load relevant repo-local skills from `.agents/skills/` when matching work:

- TypeScript work → load `typescript-best-practices`.
- Tailwind class work → load `tailwind-best-practices`.
- SvelteKit work → load `sveltekit-best-practices`.
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

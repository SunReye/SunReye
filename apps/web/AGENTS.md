# Frontend

**This project uses [bun](https://bun.sh/) as its JavaScript runtime and package manager.**

Work in `apps/web`. Route by task:

- Any `.svelte` file (page, card, grid, chart box, live reading) → load the `layout-system` skill
  first. Measure, gutter, rhythm, columns, chart heights and value ownership are decided in
  `src/lib/layout/tokens.ts` and `src/lib/live/ownership.ts`.
- UI/UX → `apps/web/DESIGN.md`. Anything that animates, especially in the power-flow hero, answers the
  motion tier (`$lib/motion/tier`): see DESIGN.md, "…and the device has to be able to afford it".
- Tests, and any new or changed page or user-visible component → `apps/web/TESTING.md`, from "Three
  layers". The e2e layer fakes the whole backend. A test never regexes over a source file: assert
  rendered behaviour.
- Env vars → `packages/env/AGENTS.md`. Import the shared env exports; no app-local schemas.
- Svelte or SvelteKit questions → the `svelte` MCP: `list-sections` first, `svelte-autofixer` on
  Svelte code until it returns nothing.
- shadcn-svelte questions → the `shadcn-svelte-components` MCP.

## UI components

- Compose from `src/lib/components/ui/` first.
- No match there: add the upstream shadcn component (`bun x shadcn-svelte@latest add -y -o <Name>`).
  No upstream component: build one local reusable component, not duplicated styled markup per route.
- Prefer a component's `child` / render snippet over replacing it with raw elements. Raw HTML is for
  structure and content inside composed components, not for surfaces, controls, dialogs, navigation
  or form primitives.

## Hash router constraint

`router.type: 'hash'` (svelte.config.js) lets one build run behind path-prefixed reverse proxies
(Home Assistant ingress).

- Internal navigation goes through `resolve()` from `$app/paths`: `goto(resolve('/login'))`,
  `<a href={resolve('/history')}>`. A raw `goto('/login')` or `href="/login"` does a full-page
  navigation that escapes the ingress prefix and 404s.
- No `+page.server.ts` / `+layout.server.ts` / per-page options: SSR is off.

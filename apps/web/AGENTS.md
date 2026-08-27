# Frontend Agent Instructions

**This project uses [bun](https://bun.sh/) as its JavaScript runtime and package manager.**

Use this file for work in `apps/web`.

If adding, reading, validating, or renaming env vars, also follow `packages/env/AGENTS.md`. Env schemas live there only; import shared env exports instead of making app-local duplicates.

Before editing any `.svelte` file here — a page, a card, a grid, a chart box, a live reading — load
the `layout-system` skill. Measure, gutter, rhythm, columns, chart heights and value ownership are
decided in `src/lib/layout/tokens.ts` and `src/lib/live/ownership.ts`, and five test files reject a
hand-rolled alternative.

For frontend UI/UX work, also read `apps/web/DESIGN.md`.
For frontend testing work, and after adding/changing pages or user-visible components, also read `apps/web/TESTING.md` — start at "Which layer does this test belong in", which picks between a unit test, a browser spec and (rarely) a source-text test.
For anything that only exists in a running document — a reactive loop, a request storm, scroll cost, an animation that never settles — use the browser layer in `apps/web/e2e` (`bun run e2e`) instead of a source-text test. It fakes the whole backend, so it needs no server, database or inverter, and `scripts/require-tests.ts` counts an `e2e/*.spec.ts` as a test changing, so a fix covered only there satisfies the TDD gate. See "Adding a spec" in `TESTING.md`.
A source-text test is the last resort and is not coverage: it passes for broken code and fails for a rename. `src/lib/inverter/store-backfill-wiring.test.ts` documents that trade-off at the top of the file, and `e2e/shell-lease-loop.spec.ts` is what actually proves the bug it names is gone.

<!-- ShadCN-Svelte:BEGIN -->

For ANY question regarding **Shadcn Svelte UI components**, use the `shadcn-svelte-components` (mcpdoc) server to provide accurate, up-to-date answers.

To install components, use:

```bash
bun x shadcn-svelte@latest add -y -o ${ComponentName}
```

**Default UI policy for this repo:**

- Always prefer composing UI from existing shadcn-svelte components in `apps/web/src/lib/components/ui/`.
- Before building custom UI, check whether an existing shadcn component or subcomponent already covers the need.
- If a matching shadcn component does not exist yet, install/add the canonical shadcn component first when one exists upstream.
- If no upstream shadcn component exists for the pattern, build a local reusable component instead of duplicating ad-hoc styled markup across routes.
- When a shadcn component supports `child`/render snippet composition, prefer that over replacing it with raw custom elements.
- Raw HTML should be limited to semantic structure and content inside composed shadcn components, not used as a replacement for available shadcn surfaces, controls, dialogs, navigation, or form primitives.

1. **Discover Sources**: Call the `list_doc_sources` tool to identify available documentation sets.
2. **Retrieve Index**: Call the `fetch_docs` tool on the primary `llms.txt` file for the relevant technology.
3. **Analyze Content**:
   - Reflect on the structure and URLs provided within the `llms.txt` file.
   - Reflect on the specific user request.
4. **Targeted Retrieval**: Call `fetch_docs` on the specific sub-URLs or sections identified in the index that are directly relevant to the question.
5. **Synthesize**: Use the retrieved documentation context to generate a code-accurate and idiomatic response.

<!-- ShadCN-Svelte:END -->

<!-- Svelte-MCP:BEGIN -->

You can use the Svelte MCP server, where you have access to comprehensive Svelte 5 and SvelteKit documentation.

## Available MCP Tools

### 1. `list-sections`

Use this FIRST to discover all available documentation sections. Returns a structured list with titles, use_cases, and paths.
When asked about Svelte or SvelteKit topics, ALWAYS use this tool at the start of the chat to find relevant sections.

### 2. `get-documentation`

Retrieves full documentation content for specific sections. Accepts single or multiple sections.
After calling `list-sections`, you MUST analyze the returned documentation sections, especially the `use_cases` field, and then use `get-documentation` to fetch ALL documentation sections that are relevant for the user's task.

### 3. `svelte-autofixer`

Analyzes Svelte code and returns issues and suggestions.
You MUST use this tool whenever writing Svelte code before sending it to the user. Keep calling it until no issues or suggestions are returned.

### 4. `playground-link`

Generates a Svelte Playground link with the provided code.
After completing the code, ask the user if they want a playground link. Only call this tool after user confirmation and NEVER if code was written to files in their project.

<!-- Svelte-MCP:END -->

## Hash router constraint

This app uses SvelteKit's hash router (`router.type: 'hash'` in
svelte.config.js) so one build works behind path-prefixed reverse proxies
(Home Assistant ingress). Consequences:

- **Internal navigation must go through `resolve()` from `$app/paths`**:
  `goto(resolve('/login'))`, `<a href={resolve('/history')}>`. A raw
  `goto('/login')` or `href="/login"` triggers a full-page navigation that
  escapes the ingress prefix and 404s.
- No `+page.server.ts` / `+layout.server.ts` / per-page options — SSR is off.
- Reading `page.url.pathname` still yields the route path ('/history') and
  needs no changes.

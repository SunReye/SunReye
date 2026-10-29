# Testing the dashboard

Repo-wide policy is `CONTRIBUTING.md` §6 and the root `AGENTS.md`: **the failing test comes
first**, and CI blocks a PR whose source changed without a test. This file is the frontend
half — what that means when the thing you changed is a Svelte component.

```bash
cd apps/web
bun run test             # bun test ./src — logic, seconds, runs on every commit
bun run test:components  # Vitest browser mode — one component mounted in Chromium
bun run check            # svelte-check (types, unused props, a11y)
bun run e2e              # Playwright: the whole app, a faked backend (see below)
```

## Three layers, and what each is for

| The claim is about…                                              | Write a…           | Where                         |
| ---------------------------------------------------------------- | ------------------ | ----------------------------- |
| a value, a branch, a boundary — "what does this return"           | **unit test**      | `src/**/*.test.ts`            |
| one component — "what does it render, how does it react"          | **component test** | `src/**/*.svelte.test.ts`     |
| a user journey or the running shell — routes, socket, scheduler   | **browser spec**   | `e2e/*.spec.ts`               |

There is no fourth row. **Do not write a test that reads a `.svelte`/`.ts` file as text and
regexes over it.** The suite used to hold ~30 of them (~8k lines): they passed for broken code,
failed for a rename, and contributed nothing to coverage. They were deleted, and what they guarded
that a user could actually see broken is now asserted in a rendered document. A convention with no
runtime consequence (which class name a grid spends) is a review and skill matter
(`layout-system`), not a test. A test may still read a DATA file — a manifest, a message catalogue,
`app.css` token values — because that is input, not the code under test.

`scripts/require-tests.ts` counts all three layers as "a test changed".

### Unit tests — decisions

**Default here.** Milliseconds, every commit, and the only layer the coverage floor measures. If
the logic is hard to reach because it lives in a component, extracting it into a plain `.ts` is part
of the change (see "The one rule" below). Don't write a case that restates a constant — test the
boundary the constant decides.

### Component tests — one component, really rendered

`vitest.config.ts` runs Vitest in **browser mode**: the component is compiled by the real Svelte
plugin, mounted with `vitest-browser-svelte`'s `render`, in headless Chromium, with Tailwind and
`app.css` loaded. Runes run, effects run, layout is real — so a 44px tap target, a 390px row that
must not wrap, a caret that unmounts a body, a tween that settles on the exact value are all
assertable directly.

```ts
import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import FieldInfo from "./field-info.svelte";

test("keeps the explanation behind a tap", async () => {
  render(FieldInfo, { label: "Feed-in limit", info: "Caps export at the meter." });
  await expect.element(page.getByText("Caps export at the meter.")).not.toBeInTheDocument();
  await page.getByRole("button", { name: /Feed-in limit/ }).click();
  await expect.element(page.getByText("Caps export at the meter.")).toBeVisible();
});
```

- **Name it `*.svelte.test.ts`, next to the component.** `bun test` ignores that suffix
  (`pathIgnorePatterns` in both bunfigs); Vitest picks up nothing else.
- **Phone width:** `await page.viewport(390, 844)` before `render`.
- **Context, snippets, slots:** mount a small `*.fixture.svelte` beside the test that sets the
  context or passes the snippet (`section.fixture.svelte`, `stat-tiles.fixture.svelte`).
- **Modules that reach the network or `$env`:** `vi.mock("$lib/api")`,
  `vi.mock("$env/dynamic/public", () => ({ env: {} }))`. Vitest mocks are per file — the bun
  `mock.module` hygiene rules do not apply here.
- **Hidden elements:** `getByRole` skips them unless `{ includeHidden: true }`.
- **A pseudo-element hit area** (`TAP`) is invisible to `getBoundingClientRect`; ask
  `document.elementFromPoint` what a tap off the icon lands on (`field-info.svelte.test.ts`).
- If the component needs the app shell (stores booted, socket, routes) to mount, it belongs in
  `e2e/` instead.

### Browser specs — the app and its journeys

Playwright proves **behaviour in a running app** — the things that only exist once there is a
router, a scheduler and a socket: a reactive loop, a scroll that mounts sixty charts, a request
storm, and the user journeys that cross pages. The `journey-*.spec.ts` files walk the four paths a
user cannot afford to have broken, like a user (roles, labels, clicks), asserting what they see:

| Journey                              | Spec                               |
| ------------------------------------ | ---------------------------------- |
| boot → live dashboard → History      | `journey-dashboard-live.spec.ts`   |
| browse History by day/week/month     | `journey-history-browse.spec.ts`   |
| Settings → Add device wizard → listed| `journey-add-connection.spec.ts`   |
| session expires → sign in → resume   | `journey-session-expiry.spec.ts`   |

A new user-facing flow gets a journey; a bug in the shell gets a focused spec.

The layer lives in `e2e/`, outside the `./src` glob `bun test` is pointed at, so bun never tries to
import `@playwright/test` and the unit suite stays seconds long. It is a separate CI job for the
same reason.

Nothing in it needs the engine, Postgres/TimescaleDB or an inverter. `e2e/support/api-mock.ts`
answers every `/api/*` call with `page.route` and serves the multiplexed live socket with
`page.routeWebSocket`, off a committed 105-metric Deye manifest
(`e2e/fixtures/manifest.json`). It records every write (`backend.writes`) so a journey can assert
the body the UI sent. A run is one command with no setup:

```bash
bun run e2e:install          # once: downloads Chromium (the component layer uses it too)
bun run e2e                  # the suite
bun run e2e e2e/x.spec.ts    # one spec — prefer this while iterating
bun run e2e -- --shard=1/4   # what CI runs, four ways in parallel
```

The suite runs **fully parallel**: every file, and every test within a file, can land on a
different worker. CI shards it across four runners. Nothing here holds cross-file state — the
backend is faked per page — so any split is valid.

**This layer does not measure performance.** Frame rates, mount cost and CPU-throttled scroll
sweeps were removed: a measured fps is only comparable when nothing else is running. What is left
asserts what a contended machine cannot change: layout, request counts, mount counts, socket
lifecycle. The instruments are in `e2e/support/perf.ts` — `countRequests`, `countChartMounts`,
`countTextMutations`, `measureScroll`, `throttleCpu`; the counting ones are contention-independent.

### The worked example

An `$effect` in `routes/(app)/+layout.svelte` took a reactive dependency on the `SvelteMap` of
live buffers that its own backfill then wrote. The effect invalidated on its own write, its
cleanup released the socket and the metrics lease, it re-ran, re-leased and re-fetched — ~12
cycles a second of `/api/profile` + `/api/history/recent`, a WebSocket closed before it could
finish opening 2708 times, and every reading on the dashboard rendering as an em dash while the
server was healthy.

The first "test" was a regex asserting the fix's own text (`untrack(() =>
this.#live.newestHeldMs())`) was still in the file. It passed for any *other* reactive read that
reintroduced the loop, and failed for a rename that changed nothing. It is gone.

The coverage that actually exists is `e2e/shell-lease-loop.spec.ts`, which boots the app and
counts: boot calls in a settled 3s window (0 — the pre-fix build scores ~400), socket opens (1 —
pre-fix, hundreds), `unsub` frames (0). It has been watched fail against the reverted fix and it
does not care how the fix is spelled.

### Adding a spec

Copy the shape of an existing one; the whole harness is three modules in `e2e/support/`.

```ts
import { expect, test } from "@playwright/test";
import { mockBackend } from "./support/api-mock";
import { countRequests } from "./support/perf";

test("the shell boots once and stays booted", async ({ page }) => {
  const backend = await mockBackend(page);   // MUST come before goto
  await page.goto("/#/");                    // hash router: `/#/history`, `/#/settings`
  await backend.waitForLive();
  const calls = await countRequests(page, /\/api\/profile$/, () => page.waitForTimeout(3000));
  expect(calls).toBe(0);
});
```

Four things worth knowing before you write one:

- **Mock first.** `mockBackend(page)` installs the routes; calling it after `goto` mocks nothing
  and the page silently sits behind its first-run gate. Assert `backend.unhandled` is `[]` when
  you add a route that fetches something new.
- **`/history` has a helper.** `openHistory(page)`, `metricCards`, `mountedCharts`,
  `selectRange` in `support/history.ts` — so a markup change costs one edit, not one per spec.
- **Don't wait for a thing your assertion is about.** If the spec's subject is the live socket
  staying up, `await backend.waitForLive()` turns the regression into a setup timeout instead of
  a number. Poll the counter you are about to assert on.
- **Don't pin a number that contention can move.** This browser composites in software and the
  suite runs parallel and sharded, so an fps or a millisecond floor measures the runner, not the
  app. Count things instead — requests, mounts, mutations — which come out the same however loaded
  the machine is. (The control-group spec this bullet used to point at was one of the measurement
  specs that were removed.)

And the rule that outranks all of them: **prove the spec discriminates.** Apply the exact
regression it names, watch it go red, restore. A regression test nobody has watched fail is a
guess.

## The one rule that decides where a unit test goes

A component is a rendering of a decision. **Test the decision in a unit test, the rendering in a
component test.** Runes do not run under `bun test`, so the decision has to live in a plain module
the unit suite can call directly:

| Decision                                    | Lives in                        | Proven by                        |
| ------------------------------------------- | ------------------------------- | -------------------------------- |
| Is this response actually data?              | `src/lib/api-payload.ts`        | `api-payload.test.ts`            |
| Which bars does a range get?                 | `src/lib/cost/ranges.ts`        | `ranges.test.ts`                 |
| What range does a zoom selection mean?       | `src/lib/charts/zoom-range.ts`  | `zoom-range.test.ts`             |

So when a component grows an `$derived` with real logic in it, or an `{#if}` whose condition
is more than a null check, that condition is the unit. Lift it into a `.ts` next to the
component (or into `_shared/`), export it, test it, and let the component call it. The
extraction is part of the change.

What stays in the component: markup, class strings, prop wiring, `$effect` plumbing. That is
what the component layer is for — mount it and assert what renders — and `$effect` plumbing that
spans the shell (the PR #60 outage) is a browser spec.

**Prove every test discriminates.** Apply the exact regression it names, watch it go red, restore.
A test nobody has watched fail is a guess.

## What to cover

The failure mode on this dashboard is not a crash, it is a **plausible wrong number on a
screen nobody is watching**. Write the cases that produce one:

- **Absent vs empty vs zero.** `0` is a reading; `""` is not. The server answers `null` for a
  disabled feature, Elysia sends that as an empty body, and Eden hands it back as `""` — so
  `data ?? null` keeps it and the guard downstream passes. Always normalize through
  `payloadOrNull` (or a shape guard like `isReadableWeather`), and test the empty body
  explicitly.
- **Negative and zero values.** −7.5 °C is a temperature, 0 kWh is a total, a negative price
  is a real market condition. Never let a falsy check stand in for a presence check.
- **Stale data.** A sample carried across midnight must not overwrite today; a reading from
  another inverter must not land on this one.
- **Boundaries of a window.** A range that starts mid-day, a range that ends in the past, a
  month that contains the day inside it.
- **Locale and units.** Anything that reaches `toLocaleString` — including the case where the
  unit is missing.

## Conventions

- Colocate: `foo.ts` → `foo.test.ts`. `bun test ./src` picks it up (`./src`, never `src` — a
  bare path substring also matches a stale `dist/src`).
- Name tests as the behaviour in domain terms — "0 °C is readable — a falsy temperature is
  still a temperature" — not "returns true".
- Comment *why* a case exists when it encodes a real incident. The next reader should not have
  to guess whether a case is paranoia or a scar.

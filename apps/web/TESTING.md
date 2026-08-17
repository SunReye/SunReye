# Testing the dashboard

Repo-wide policy is `CONTRIBUTING.md` §6 and the root `AGENTS.md`: **the failing test comes
first**, and CI blocks a PR whose source changed without a test. This file is the frontend
half — what that means when the thing you changed is a Svelte component.

```bash
cd apps/web
bun run test        # bun test ./src  — seconds, runs on every commit
bun run check       # svelte-check (types, unused props, a11y)
bun run e2e         # Playwright: a real browser, a faked backend (see below)
```

## Two layers, and what each is for

`bun test` proves **decisions**. Playwright proves **behaviour in a document** — the things that
only exist once there is a scheduler, a compositor and a socket: a reactive loop, a scroll that
mounts sixty charts, a tween that never settles, a request storm.

The browser layer lives in `e2e/`, deliberately outside the `./src` glob `bun test` is pointed
at, so bun never tries to import `@playwright/test` (it cannot run it) and the unit suite stays
seconds long. It is a separate CI job for the same reason.

Nothing in it needs the engine, Postgres/TimescaleDB or an inverter. `e2e/support/api-mock.ts`
answers every `/api/*` call with `page.route` and serves the multiplexed live socket with
`page.routeWebSocket`, off a committed 105-metric Deye manifest
(`e2e/fixtures/manifest.json`). A run is one command with no setup:

```bash
bun run e2e:install   # once: downloads Chromium
bun run e2e
```

The measuring instruments are all in `e2e/support/perf.ts` — `countRequests`, `measureScroll`,
`countChartMounts`, `countTextMutations`, `throttleCpu` — so no spec writes its own
`page.evaluate` and two specs cannot disagree about what a long task is.

## Which layer does this test belong in

Ask what kind of claim you are making. There are three answers, and only the first two are
real coverage.

| The claim is about…                                          | Write a…             | Where            |
| ------------------------------------------------------------ | -------------------- | ---------------- |
| a value, a branch, a boundary — "what does this return"       | **unit test**        | `src/**/*.test.ts` |
| the running app — "what does it do once there is a scheduler" | **browser spec**     | `e2e/*.spec.ts`  |
| a convention that only exists as markup                       | source-text test     | `src/**/*.test.ts` |

**Default to the unit test.** It runs in milliseconds on every commit, and if the logic is
hard to reach because it lives in a component, extracting it is part of the change (see the
next section).

**Reach for a browser spec when the thing that breaks is not a value.** Anything with a
scheduler, a compositor, a socket or an observer in it: a reactive loop, a lease taken twice,
a request storm, sixty charts mounting on a scroll, a tween that never settles, an intersection
gate. Runes do not run under `bun test`, so for this class the browser is not a nicer option —
it is the only one. `scripts/require-tests.ts` counts an `e2e/*.spec.ts` as a test changing, so
a fix covered only there satisfies the TDD gate.

**Source-text tests are a last resort, and they are not coverage.** They pin a convention that
genuinely has no runtime value to assert — the layout vocabulary, the live-value ownership rule.
Everything else they touch, they get wrong in both directions: they pass for broken code and
fail for a rename. The technique and its rules are below; the honest example of its limits is
`lib/inverter/store-backfill-wiring.test.ts`.

### The worked example, both ways

An `$effect` in `routes/(app)/+layout.svelte` took a reactive dependency on the `SvelteMap` of
live buffers that its own backfill then wrote. The effect invalidated on its own write, its
cleanup released the socket and the metrics lease, it re-ran, re-leased and re-fetched — ~12
cycles a second of `/api/profile` + `/api/history/recent`, a WebSocket closed before it could
finish opening 2708 times, and every reading on the dashboard rendering as an em dash while the
server was healthy.

The first attempt was `store-backfill-wiring.test.ts`, a regex asserting the fix's own text
(`untrack(() => this.#live.newestHeldMs())`) is still in the file. It passes for any *other*
reactive read that reintroduces the loop, and fails for a rename that changes nothing.

The coverage that actually exists is `e2e/shell-lease-loop.spec.ts`, which boots the app and
counts: boot calls in a settled 3s window (0 — the pre-fix build scores ~400), socket opens (1 —
pre-fix, hundreds), `unsub` frames (0), and a power-flow readout holding a digit rather than an
em dash. It has been watched fail against the reverted fix and it does not care how the fix is
spelled. The regex is kept as a fast canary, with its limits written at the top of the file.

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
- **Numbers are ratios, never floors.** This browser composites in software.
  `e2e/overview-baseline.spec.ts` is the control group; compare against it rather than pinning
  an fps.

And the rule that outranks all of them: **prove the spec discriminates.** Apply the exact
regression it names, watch it go red, restore. A regression test nobody has watched fail is a
guess.

## The one rule that decides where a unit test goes

A component is a rendering of a decision. **Test the decision, not the rendering.**

The dashboard has no component-rendering harness, and adding one would not have caught either
of the bugs that motivated these gates. Runes (`$state`/`$derived`) do not run under `bun test`
either, so a `.svelte.ts` store is testable only in the parts that are plain functions. What
catches the bugs is moving the decision into a plain module the suite can call directly:

| Decision                                    | Lives in                        | Proven by                        |
| ------------------------------------------- | ------------------------------- | -------------------------------- |
| Is this response actually data?              | `src/lib/api-payload.ts`        | `api-payload.test.ts`            |
| Which bars does a range get?                 | `src/lib/cost/ranges.ts`        | `ranges.test.ts`                 |
| What range does a zoom selection mean?       | `src/lib/charts/zoom-range.ts`  | `zoom-range.test.ts`             |

So when a component grows an `$derived` with real logic in it, or an `{#if}` whose condition
is more than a null check, that condition is the unit. Lift it into a `.ts` next to the
component (or into `_shared/`), export it, test it, and let the component call it. The
extraction is part of the change.

What stays in the component: markup, class strings, prop wiring, `$effect` plumbing. "Stays in the
component" is not "is untestable" — `$effect` plumbing is what the PR #60 outage was made of, and
that is a browser spec, not a regex. Rendering is
still not unit-tested — but a **convention** that lives in markup is, by reading the source. The
layout vocabulary, the mobile floors, the live-value ownership rule and the chart zoom gestures are
all conventions of that kind, and seven files pin them by reading `.svelte` sources:

- `lib/layout/primitives.test.ts` — the primitives spend the tokens
- `lib/layout/mobile-density.test.ts` — grids, tap targets, chart boxes and gutters, tree-wide
- `lib/layout/section-migration.test.ts` — one section recipe, with an exact offender list
- `lib/components/layout/header-and-toolbar-rows.test.ts` — the shell's header and toolbar rows
- `routes/(app)/page-shells.test.ts` — every page's shell shape, discovered from disk
- `lib/live/wiring.test.ts` — one owner per live value
- `lib/charts/zoom-wiring.test.ts` — which charts zoom, and that the gesture reaches a refetch

A page that hand-rolls its own shell is not a visual bug you catch in the browser; it is a decision
nobody made, and it fails the suite.

## Writing a source-text test

The technique has one rule, learned the expensive way: **pin the structure, or pin the identifier
that is actually passed. Never pin that a string appears somewhere in the file.**

A `toContain` over the whole file passes on a comment, on a dead branch, on the class sitting on
the wrong element, and on the right helper called with the wrong argument. Every one of those is a
shipped bug with a green test.

Bad — every chart in `mobile-density.test.ts` measures its plot width, and this says so:

```ts
expect(code).toContain("bind:clientWidth");
expect(code).toContain("chartPaddingFor(");
```

That stays green for `bind:clientWidth={plotWidth}` next to `chartPaddingFor(0)` — and every gutter
helper reads `0` as the desktop case, so every phone chart quietly keeps its 60px gutter.

Good — capture the bound identifier and require every gutter call in the file to spend *that
variable* as its width argument, rather than to exist.

The zoom work made this exact mistake seven times, and the sharpest one is worth copying out.
`zoomedHistoryRangeFrom` is what turns a brush selection into a refetch — it re-derives the
*bucket*, which is the whole feature — so the chart was pinned like this:

```ts
expect(svelte(chart)).toContain("zoomedHistoryRangeFrom(");
```

That stays green while the chart calls the mapper, discards the range it returned, and emits its
own object with the current rollup: `onZoom?.({ ...next, bucket })`. The gesture then narrows the
axis over data already fetched — four hourly bars, magnified — which is the one thing a zoom must
not do. Green test, shipped bug, one token of difference.

The fix (`lib/charts/zoom-wiring.test.ts`) captures what the mapper was assigned to and requires
*that identifier* to be the thing handed on:

```ts
const emitted = /const\s+(\w+)\s*=\s*zoomedHistoryRangeFrom\(/.exec(code)?.[1] ?? "";
expect(emitted).not.toBe("");
const [handed] = argumentsOf(code, "onZoom?.");
expect(handed).toBe(emitted);
```

Do not re-derive the parsers for this. `zoom-wiring.test.ts` carries `argumentsOf` (an argument
list split at depth-0 commas), `declaration` (a whole `const x = …`, to the `;` that ends it rather
than the first one inside it), `methodBody` and `openTagOf`; `page-shells.test.ts` carries `rootTag`
and `enclosingTags`; `mobile-density.test.ts` carries `classValues` and `classValuesOn`. Each one is
a claim about structure that a substring cannot make.

The same discipline in its other forms:

- **Parse a bounded opening tag** when the claim is about an element: `openTagOf()` in
  `section-migration.test.ts` and `rootTag()` in `page-shells.test.ts` consume attribute values as
  units so a `>` in a string or the `=>` in `onOpenChange={(v) => …}` does not end the tag early.
  `<Section nested>` is a claim about a tag; "the file mentions nested" is not.
- **Assert the branch, not the operands.** `wiring.test.ts` matches the whole ternary, because
  swapping its two arms is a one-token merge slip that inverts the behaviour while both strings are
  still present.
- **Discover the file set from disk, and assert an exact set.** `page-shells.test.ts` globs
  `**/+page.svelte`; `section-migration.test.ts` compares the offender list to an explicit
  allowlist. A new violation is a new entry, so it fails until someone migrates it or writes down
  why it belongs.
- **Derive the expectation from the token** rather than restating it beside the assertion —
  `tapTargetPx(16)` is `{44, 44}` because the token says so, so a shrunk inset is red instead of
  silent.

And prove the test discriminates before you believe it: apply the exact regression it names, watch
it go red, then restore.

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

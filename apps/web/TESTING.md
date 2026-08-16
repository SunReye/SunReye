# Testing the dashboard

Repo-wide policy is `CONTRIBUTING.md` §6 and the root `AGENTS.md`: **the failing test comes
first**, and CI blocks a PR whose source changed without a test. This file is the frontend
half — what that means when the thing you changed is a Svelte component.

```bash
cd apps/web
bun run test        # bun test ./src
bun run check       # svelte-check (types, unused props, a11y)
```

## The one rule that decides where a test goes

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

What stays in the component: markup, class strings, prop wiring, `$effect` plumbing. Rendering is
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

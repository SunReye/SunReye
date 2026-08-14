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
of the bugs that motivated these gates. What catches them is moving the decision into a plain
module the suite can call directly:

| Decision                                    | Lives in                        | Proven by                        |
| ------------------------------------------- | ------------------------------- | -------------------------------- |
| Is this response actually data?              | `src/lib/api-payload.ts`        | `api-payload.test.ts`            |
| Is this weather reading printable?           | `_shared/weather.ts`            | `weather.test.ts`                |
| Which bars does a range get?                 | `src/lib/cost/ranges.ts`        | `ranges.test.ts`                 |
| How does a number become a label?            | `src/lib/format/format.ts`      | `format.test.ts`                 |

So when a component grows an `$derived` with real logic in it, or an `{#if}` whose condition
is more than a null check, that condition is the unit. Lift it into a `.ts` next to the
component (or into `_shared/`), export it, test it, and let the component call it. The
extraction is part of the change.

What stays in the component: markup, class strings, prop wiring, `$effect` plumbing. If a
bug can only live there, it is a visual bug — catch it in the browser, not in a unit test.

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
- Svelte runes (`$state`/`$derived`) do not run under `bun test`. A `.svelte.ts` store is
  testable only in the parts that are plain functions — another reason to keep the decision
  out of the reactive layer.

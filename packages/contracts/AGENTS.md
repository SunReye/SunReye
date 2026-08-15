# @SunReye/contracts — the wire, erased at build

This package is the single definition site for the **wire shapes** the server and
the web app share: the types that cross the HTTP/WebSocket boundary. It is not a
dumping ground for "all shared types" — server-internal shapes (`AutomationIO`,
`PeakShavingEngine`, `DecisionInputs`, `SpotPriceProvider`, `EvccAction`, …) stay
in the server.

## The one invariant: no value exports, ever

**A `const`, `enum`, `class`, or function here is a runtime tail into the browser
bundle.** Every file exports `type`/`interface` only. `verbatimModuleSyntax` +
`isolatedModules` erase these files entirely at build time — they emit no
JavaScript, no lcov `SF:` records, and cost nothing at runtime. Add a value and
that stops being true: web imports of this package would start pulling real code
(and, transitively, whatever that value imports — drizzle tables, a logging
library) into the client. If you need a runtime helper next to a wire type, it
belongs in the server module that owns the behaviour, not here.

## File layout: `src/<domain>/types.ts`, deliberately

The exports map is `"./*": { "default": "./src/*/types.ts" }` — a subpath per
domain, each resolving to a `types.ts`. Import as `@SunReye/contracts/energy`,
`@SunReye/contracts/statistics`, etc. There is **no `"."` barrel and no
`src/index.ts`**: an unimported barrel trips `unused-files`.

The `types.ts` naming is load-bearing, not cosmetic. `scripts/require-tests.ts`
exempts `/\/types\.ts$/`, so a type-only file needs no colocated test without any
change to the gate. A path-shaped exemption (`^packages/contracts/src/`) would
silently excuse a future *runtime* file dropped in here — exactly the thing the
no-value-exports invariant forbids. Keep the name; keep the invariant.

## Dependencies

`@SunReye/db` and `@SunReye/inverter-core` are **`devDependencies`** and reached
**type-only** (`.fallowrc.json` gives the `contracts` zone `"allow": []` plus
`"allowTypeOnly": ["db", "inverter-core"]`). A value import from either is a
boundary violation — that is the mechanism that keeps drizzle tables and other
runtime code out of the browser's type graph.

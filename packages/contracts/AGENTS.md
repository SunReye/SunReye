# @SunReye/contracts

Single definition site for the wire shapes the server and web app share: the types that cross the
HTTP/WebSocket boundary. Server-internal shapes (`AutomationIO`, `PeakShavingEngine`,
`DecisionInputs`, …) stay in the server.

## No value exports, ever

Every file exports `type` / `interface` only. `verbatimModuleSyntax` + `isolatedModules` erase them
at build. A `const`, `enum`, `class` or function is a runtime tail into the browser bundle and pulls
in whatever it imports (drizzle tables, a logger). A runtime helper beside a wire type belongs in
the server module that owns the behaviour.

## Layout: `src/<domain>/types.ts`

- Exports map `"./*": { "default": "./src/*/types.ts" }`; import as `@SunReye/contracts/energy`.
  No `"."` barrel and no `src/index.ts`: an unimported barrel trips fallow `unused-files`.
- Keep the `types.ts` name. `scripts/require-tests.ts` exempts `/\/types\.ts$/`, so type-only files
  need no test; a path-shaped exemption would also excuse a runtime file dropped in here.

## Dependencies

`@SunReye/db` and `@SunReye/inverter-core` are `devDependencies`, reached type-only
(`.fallowrc.json`, `contracts` zone: `allow: []`, `allowTypeOnly: ["db", "inverter-core"]`). A value
import from either is a boundary violation.

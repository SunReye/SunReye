/**
 * Wire TypeBox into Elysia statically, so the compiled binary can validate.
 *
 * Elysia 2 loads TypeBox's namespaces lazily, through a synchronous
 * `require("typebox/value")` inside its route compiler
 * (`elysia/dist/type/typebox-value.mjs`). A bundler cannot see a dynamic
 * require, so `bun build --compile` leaves it external and the binary has no
 * TypeBox in it. Nothing fails at boot: the require happens the first time a
 * route with a schema is COMPILED, so the server starts, serves `/healthz` and
 * `/openapi`, and then answers the first real request with
 *
 *     [Elysia] Failed to compile route GET /api/cost:
 *     Cannot find module 'typebox/value'  (require-call, referrer /$bunfs/root/server)
 *
 * Elysia's own error text names the two fixes: build with `elysia/plugin/aot`,
 * or hand it the namespaces. This is the second — static imports the bundler
 * follows, no build plugin, and it works identically under `bun run`.
 *
 * All five are required together. `value`/`schema`/`compile` alone still reach
 * the type leaf through Elysia's `ensureTypeSettings()` and fail the same way.
 *
 * Imported for effect by ../index before any route is registered.
 */
import { setupTypebox } from "elysia";
import * as compile from "typebox/compile";
import * as schema from "typebox/schema";
import * as system from "typebox/system";
import * as type from "typebox/type";
import * as value from "typebox/value";

/** The namespaces Elysia would otherwise `require()` at route-compile time. */
// fallow-ignore-next-line unused-export -- the five-namespace contract is asserted by typebox-static.test.ts; test files aren't traced as consumers
export const TYPEBOX_NAMESPACES = { value, schema, compile, type, system };

let done = false;

export function setupStaticTypebox(): void {
  if (done) return;
  setupTypebox({ typebox: TYPEBOX_NAMESPACES });
  done = true;
}

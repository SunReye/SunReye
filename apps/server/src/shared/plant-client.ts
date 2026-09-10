/**
 * The shared drizzle client, narrowed to the `execute`-only shape every
 * repository module in `@SunReye/db` takes.
 *
 * `plant-repo.ts`'s `PlantDb` is structural on purpose — a repository that
 * imported the app's client would drag the environment into everything that
 * imports it — so each caller has to hand it one. Spelled inline, that is the
 * same six-token literal at seven call sites, and each one has to get the
 * `Parameters<typeof db.execute>[0]` right for the shapes to line up.
 *
 * BUILT PER CALL, never hoisted to a module constant: `mock.module` on
 * `@SunReye/db` replaces the `db` binding, and a client captured at import time
 * would still be holding the real one.
 */

import { db } from "@SunReye/db";

/** A fresh `PlantDb` over the shared connection. */
export function plantClient() {
  return { execute: (query: Parameters<typeof db.execute>[0]) => db.execute(query) };
}

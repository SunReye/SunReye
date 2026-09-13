import { describe, expect, test } from "bun:test";
import { surfacesFor } from "./ci-surfaces";

/**
 * The gating rule is "this layer cannot possibly be affected", never "this
 * layer probably passes". Every case below that expects `false` is one where
 * the layer's inputs are provably untouched; anything unrecognised runs
 * everything.
 */
describe("surfacesFor", () => {
  test("a docs-only change touches no executable layer", () => {
    expect(
      surfacesFor([
        "apps/docs/src/content/docs/use/dashboard.md",
        "apps/docs/public/screenshots/dashboard-dark.png",
        "README.md",
      ]),
    ).toEqual({ web: false, db: false, routes: false });
  });

  test("the browser layer runs for web sources", () => {
    expect(surfacesFor(["apps/web/src/lib/components/dashboard/house-card.svelte"]).web).toBe(true);
  });

  // The browser suite fakes the backend entirely — no Elysia, no Postgres, no
  // inverter — so a server-only change cannot alter a single browser assertion.
  test("the browser layer does not run for a server-only change", () => {
    const surfaces = surfacesFor(["apps/server/src/inverter/runtime.ts"]);
    expect(surfaces.web).toBe(false);
    expect(surfaces.db).toBe(true);
    expect(surfaces.routes).toBe(true);
  });

  test("the database layer runs for schema and image changes", () => {
    expect(surfacesFor(["packages/db/src/schema.ts"]).db).toBe(true);
    expect(surfacesFor(["docker/timescaledb/Dockerfile"]).db).toBe(true);
  });

  test("a shared package runs every layer that can import it", () => {
    const surfaces = surfacesFor(["packages/env/src/index.ts"]);
    expect(surfaces).toEqual({ web: true, db: true, routes: true });
  });

  // A dependency change can move any layer, and the lockfile is how it lands.
  test("the lockfile and the root manifest run everything", () => {
    expect(surfacesFor(["bun.lock"])).toEqual({ web: true, db: true, routes: true });
    expect(surfacesFor(["package.json"])).toEqual({ web: true, db: true, routes: true });
  });

  test("editing the workflow itself runs everything it gates", () => {
    expect(surfacesFor([".github/workflows/ci.yml"])).toEqual({
      web: true,
      db: true,
      routes: true,
    });
  });

  // The appliance has its own workflow and shares no runtime code with these.
  test("an appliance-only change runs no layer here", () => {
    expect(surfacesFor(["nixos/modules/sunreye/default.nix", "nixos/README.md"])).toEqual({
      web: false,
      db: false,
      routes: false,
    });
  });

  test("a path nobody has classified runs everything", () => {
    expect(surfacesFor(["some/new/top-level/thing.ts"])).toEqual({
      web: true,
      db: true,
      routes: true,
    });
  });

  // An empty diff is not evidence that nothing changed — it is evidence that
  // the diff could not be computed (a force-push, a missing base, a first
  // push). Deciding "nothing to do" from it silently disables CI.
  test("an empty change list runs everything", () => {
    expect(surfacesFor([])).toEqual({ web: true, db: true, routes: true });
  });

  test("one unclassified path among ignorable ones still runs everything", () => {
    expect(surfacesFor(["apps/docs/index.mdx", "weird-new-dir/x.ts"])).toEqual({
      web: true,
      db: true,
      routes: true,
    });
  });
});

/**
 * Wiring proof for the canonical-readings layer.
 *
 * `plant.ts` and `ownership.ts` are exhaustively tested and prove nothing on
 * their own: every case in `plant.test.ts` stays green with the reactive shell
 * unplugged from the bus, or with the panel reading its numbers off the
 * automations status exactly as it did before this phase. There is no
 * component-rendering harness here (`apps/web/TESTING.md`) and runes do not run
 * under `bun test`, so — as with `$lib/layout/primitives.test.ts` — these cases
 * read the sources and assert on the connection itself.
 *
 * Both halves matter. The positive cases say the tested core is actually
 * reached: the panel leases the feeds, and each "now" quantity is bound from
 * its owner. The negative cases say nothing else can produce those numbers,
 * and are written against the *shape* of the old bug rather than its five
 * original sites, so the next cross-topic merge is caught too.
 */

import { describe, expect, test } from "bun:test";

const LIVE = new URL("./", import.meta.url);
const AUTOMATIONS = new URL("../components/automations/", import.meta.url);

async function source(base: URL, file: string): Promise<string> {
  return await Bun.file(new URL(file, base)).text();
}

const shell = await source(LIVE, "plant.svelte.ts");
const panel = await source(AUTOMATIONS, "peak-shaving-status.svelte");
const tiles = await source(AUTOMATIONS, "stat-tiles.svelte");

const CONSUMERS: [string, string][] = [
  ["peak-shaving-status", panel],
  ["stat-tiles", tiles],
];

describe("the reactive shell is plugged into the real feeds", () => {
  // Without this the store subscribes to nothing: every reading is permanently
  // absent and the whole panel renders em dashes, which no unit test of
  // `PlantFeed` can notice because it is handed a bus double.
  test("the feed's topic lease goes to the app's live bus", () => {
    expect(shell).toContain("bus.subscribe(");
  });

  // With the lookup stubbed out, every metrics role resolves to nothing and
  // every register reads as "this profile has no such value" — indistinguishable
  // from the plant that produced the original bug.
  test("role→key resolution goes to the manifest in the inverter store", () => {
    expect(shell).toContain("inverter.byRole(");
  });

  test("each topic is judged by its own cadence, EVCC's through its own bound", () => {
    // The glide clamp is an animation length, not a freshness window; see
    // `evccStalenessCadenceMs`.
    //
    // Asserted on the BRANCH, not merely on both strings being present
    // somewhere in the file: swapping the two arms of the ternary is a
    // one-token slip in a merge, and it inverts the bug this was written for —
    // EVCC would get a 3 s window and read permanently stale, while a dead 1 Hz
    // poll would look live for a minute and a half.
    expect(shell).toMatch(
      /"evcc"\s*\?\s*evccStalenessCadenceMs\(evcc\.cadenceMs\)\s*:\s*bus\.cadenceMs/,
    );
  });

  test("the staleness ticker spends the tested interval decision", () => {
    expect(shell).toContain("stalenessTickMs(");
  });
});

describe("the peak-shaving panel reads every 'now' value from its owner", () => {
  // Delete the lease and the store never subscribes: the panel is a wall of em
  // dashes on a perfectly healthy plant, and every test in `plant.test.ts`
  // still passes.
  test("it leases the feeds for as long as it is mounted", () => {
    expect(panel).toMatch(/\$effect\(\(\)\s*=>\s*livePlant\.lease\(\)\)/);
  });

  const OWNED: [string, string][] = [
    ["PV power", "pv.total.power"],
    ["house load", "load.power"],
    ["battery SOC", "battery.soc"],
    ["the charge-current register", "setting.battery.max_charge_current"],
    ["the solar-sell register", "setting.solar_sell.max_power"],
    ["EV charge power", "evcc.charge.power"],
  ];

  test.each(OWNED)("%s comes from livePlant", (_name, id) => {
    expect(panel).toContain(`livePlant.read('${id}')`);
  });
});

describe("nothing else may produce a measured number", () => {
  /**
   * Mirrors of measured quantities on the engine's status object. The engine
   * reports what it decided *against*, at `controlIntervalS`; that is an audit
   * trail, and rendering it in a "now" tile is the bug in one line.
   */
  const MEASURED_MIRRORS = ["liveA", "liveSellLimitW", "liveExcessW", "loadW", "headroomKwh"];

  test.each(CONSUMERS)("%s renders no measured mirror off the status object", (_name, code) => {
    for (const field of MEASURED_MIRRORS) expect(code).not.toMatch(new RegExp(`\\b${field}\\b`));
  });

  // `evChargeW` is the one mirror with a legitimate use: whether the engine has
  // a loadpoint at all decides whether the EV rows exist. As a *value* it is
  // the same 30 s number as the rest.
  test.each(CONSUMERS)("%s uses evChargeW only as a presence gate", (_name, code) => {
    for (const hit of code.matchAll(/evChargeW\s*(.{0,7})/g))
      expect(hit[1]).toMatch(/^\s*[!=]=\s*null/);
  });

  // The old line was `liveRole('load.power') ?? status.loadW`. Peeling `.value`
  // off a Reading throws away the freshness that makes the fallback impossible
  // to write, so it is the move that has to stay unavailable — whatever the
  // right-hand side of the next `??` happens to be.
  test.each(CONSUMERS)("%s never peels the value off a Reading", (_name, code) => {
    expect(code).not.toMatch(/livePlant\.read\([^)]*\)\s*\.value/);
  });

  test.each(CONSUMERS)("%s coalesces no reading onto the engine's status", (_name, code) => {
    expect(code).not.toMatch(/\?\?\s*s(tatus)?\s*[.?]/);
  });

  test.each(CONSUMERS)("%s holds no leftover role-lookup fallback", (_name, code) => {
    expect(code).not.toContain("liveRole(");
  });

  // A `Reading` that arrives as a prop escapes the "never peel `.value`" guard
  // above, because there is no `livePlant.read(` next to it to match on. The
  // tile is where that matters most: `animatable()` is what withholds a stale
  // number from the glide, and `$derived(pv.value)` re-creates this phase's
  // headline bug in one word — a 30 s number animating as if it were live,
  // with `animatable()` still fully unit-tested and its only caller gone.
  test("the tile animates only what animatable() releases", () => {
    expect(tiles).toContain("animatable(pv)");
  });
});

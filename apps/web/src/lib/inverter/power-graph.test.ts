import { describe, expect, test } from "bun:test";
import { buildPowerGraph } from "./power-graph";
import { socColor } from "./sign-colors";
import type { CanonicalRole, InverterCapabilities } from "$lib/inverter/types";

const caps = (over: Partial<InverterCapabilities>): InverterCapabilities =>
  ({
    pvStrings: 0,
    battery: false,
    backupLoad: false,
    generator: false,
    grid: false,
    ...over,
  }) as InverterCapabilities;

const powerFrom =
  (values: Partial<Record<string, number>>) => (role: CanonicalRole, index?: number) =>
    values[index === undefined ? role : `${role}#${index}`];

describe("buildPowerGraph", () => {
  test("no capabilities → single solar node from pv total", () => {
    const g = buildPowerGraph(caps({}), powerFrom({ "pv.total.power": 1200 }));
    expect(g.nodes.map((n) => n.id)).toEqual(["solar"]);
    expect(g.segments.map((s) => s.id)).toEqual(["solar-hub"]);
    expect(g.nodes[0].flow).toBe("in");
    expect(g.nodes[0].state).toBe("Producing");
  });

  test("one node and one segment per pv string", () => {
    const g = buildPowerGraph(
      caps({ pvStrings: 3 }),
      powerFrom({ "pv.string.power#1": 500, "pv.string.power#2": 0, "pv.string.power#3": 300 }),
    );
    expect(g.nodes.map((n) => n.id)).toEqual(["pv1", "pv2", "pv3"]);
    expect(g.nodes[1].flow).toBe("idle");
    // Multi-string landscape routes take the cubic S-curve (4 pts) into the hub,
    // except a string that already sits on the hub's row, which runs straight.
    expect(
      g.segments.every((s) => s.pts.length === 4 || (s.pts.length === 2 && s.pts[0].y === g.hub.y)),
    ).toBe(true);
  });

  test("orientation moves the grid: right of the hub in landscape, sink row in portrait", () => {
    const power = powerFrom({ "grid.power": 400 });
    const landscape = buildPowerGraph(caps({ grid: true }), power, "landscape");
    const lGrid = landscape.nodes.find((n) => n.id === "grid");
    expect(lGrid?.at.x).toBeGreaterThan(landscape.hub.x);
    expect(lGrid?.at.y).toBe(landscape.hub.y);
    const portrait = buildPowerGraph(caps({ grid: true }), power, "portrait");
    const pGrid = portrait.nodes.find((n) => n.id === "grid");
    expect(pGrid?.at.y).toBeGreaterThan(portrait.hub.y);
  });

  test("portrait pv captions sit above their nodes, clear of the connectors", () => {
    const power = powerFrom({ "pv.string.power#1": 500, "pv.string.power#2": 300 });
    const portrait = buildPowerGraph(caps({ pvStrings: 2 }), power, "portrait");
    expect(portrait.nodes.every((n) => n.labelSide === "above")).toBe(true);
    const landscape = buildPowerGraph(caps({ pvStrings: 2 }), power, "landscape");
    expect(landscape.nodes.every((n) => n.labelSide === "below")).toBe(true);
  });

  test("every segment ends at the hub in both orientations", () => {
    const power = powerFrom({});
    for (const orientation of ["landscape", "portrait"] as const) {
      const g = buildPowerGraph(
        caps({ pvStrings: 2, battery: true, backupLoad: true, generator: true, grid: true }),
        power,
        orientation,
      );
      expect(g.segments.every((s) => s.pts.at(-1)?.x === g.hub.x)).toBe(true);
      expect(g.segments.every((s) => s.pts.at(-1)?.y === g.hub.y)).toBe(true);
    }
  });

  test("battery sign convention: positive discharges, negative charges", () => {
    const discharging = buildPowerGraph(
      caps({ battery: true }),
      powerFrom({ "battery.power": 800 }),
    );
    expect(discharging.nodes.find((n) => n.id === "battery")?.state).toBe("Discharging");
    expect(discharging.nodes.find((n) => n.id === "battery")?.flow).toBe("in");
    const charging = buildPowerGraph(caps({ battery: true }), powerFrom({ "battery.power": -800 }));
    expect(charging.nodes.find((n) => n.id === "battery")?.state).toBe("Charging");
    expect(charging.nodes.find((n) => n.id === "battery")?.flow).toBe("out");
  });

  test("grid uses cost colors: importing is bad, exporting is good", () => {
    const importing = buildPowerGraph(caps({ grid: true }), powerFrom({ "grid.power": 400 }));
    expect(importing.nodes.find((n) => n.id === "grid")?.color).toBe("text-sign-bad");
    expect(importing.nodes.find((n) => n.id === "grid")?.state).toBe("Importing");
    const exporting = buildPowerGraph(caps({ grid: true }), powerFrom({ "grid.power": -400 }));
    expect(exporting.nodes.find((n) => n.id === "grid")?.color).toBe("text-sign-good");
  });

  test("full capability set yields all nodes", () => {
    const g = buildPowerGraph(
      caps({ pvStrings: 2, battery: true, backupLoad: true, generator: true, grid: true }),
      () => undefined,
    );
    expect(g.nodes.map((n) => n.kind).sort()).toEqual([
      "battery",
      "generator",
      "grid",
      "load",
      "pv",
      "pv",
    ]);
    // Undefined power everywhere → everything idles (grid state included).
    expect(g.segments.every((s) => s.flow === "idle")).toBe(true);
  });

  // `has` reports whether a metric is *visible* (Settings → Sensors). Capabilities
  // stay true, so a hidden subsystem must drop its node/segment via `has` alone.
  const hidden = (keys: string[]) => (role: CanonicalRole, index?: number) =>
    !keys.includes(index === undefined ? role : `${role}#${index}`);

  test("hidden group drops its node even though the capability stays true", () => {
    const g = buildPowerGraph(
      caps({ battery: true, backupLoad: true, generator: true, grid: true }),
      () => undefined,
      "landscape",
      hidden(["generator.power"]),
    );
    const kinds = g.nodes.map((n) => n.kind);
    expect(kinds).not.toContain("generator");
    expect(kinds).toContain("battery");
    expect(g.segments.some((s) => s.id === "generator-hub")).toBe(false);
  });

  test("hiding one PV string keeps the others", () => {
    const g = buildPowerGraph(
      caps({ pvStrings: 3 }),
      powerFrom({ "pv.string.power#1": 500, "pv.string.power#3": 300 }),
      "landscape",
      hidden(["pv.string.power#2"]),
    );
    expect(g.nodes.map((n) => n.id)).toEqual(["pv1", "pv3"]);
    expect(g.segments.map((s) => s.id)).toEqual(["pv1-hub", "pv3-hub"]);
  });

  test("all strings hidden falls back to the aggregate solar node when visible", () => {
    const g = buildPowerGraph(
      caps({ pvStrings: 2 }),
      powerFrom({ "pv.total.power": 900 }),
      "landscape",
      hidden(["pv.string.power#1", "pv.string.power#2"]),
    );
    expect(g.nodes.map((n) => n.id)).toEqual(["solar"]);
  });

  test("informational mode: charger branches off the load node, load unchanged", () => {
    const g = buildPowerGraph(
      caps({ backupLoad: true, grid: true }),
      powerFrom({ "load.power": 2400 }),
      "landscape",
      () => true,
      { power: 1800, soc: 75, connected: true, charging: true, subtractFromHome: false },
    );
    const charger = g.nodes.find((n) => n.kind === "charger");
    const load = g.nodes.find((n) => n.kind === "load");
    expect(charger?.value).toBe(1800);
    expect(charger?.flow).toBe("out");
    // Load keeps its full value (EV shown as a sub-branch, not subtracted).
    expect(load?.value).toBe(2400);
    expect(load?.label).toBe("Load");
    const seg = g.segments.find((s) => s.id === "load-charger");
    expect(seg?.pts.at(-1)).toEqual(load?.at);
    // Every other segment still ends at the hub.
    expect(
      g.segments
        .filter((s) => s.id !== "load-charger")
        .every((s) => s.pts.at(-1)?.x === g.hub.x && s.pts.at(-1)?.y === g.hub.y),
    ).toBe(true);
  });

  test("residual mode: home = load − ev, EV is a hub sibling, they sum to load", () => {
    const g = buildPowerGraph(
      caps({ backupLoad: true, grid: true }),
      powerFrom({ "load.power": 2400 }),
      "landscape",
      () => true,
      { power: 1800, connected: true, charging: true, subtractFromHome: true },
    );
    const charger = g.nodes.find((n) => n.kind === "charger");
    const load = g.nodes.find((n) => n.kind === "load");
    expect(load?.value).toBe(600); // 2400 − 1800
    expect(load?.label).toBe("Home");
    expect(charger?.value).toBe(1800);
    // No sub-branch: the EV takes a normal hub rail like any sibling node.
    expect(g.segments.some((s) => s.id === "load-charger")).toBe(false);
    expect(
      g.segments.every((s) => s.pts.at(-1)?.x === g.hub.x && s.pts.at(-1)?.y === g.hub.y),
    ).toBe(true);
    // home + ev reconstructs the metered load.
    expect((load?.value ?? 0) + (charger?.value ?? 0)).toBe(2400);
  });

  test("residual mode clamps a transient-negative home to 0", () => {
    const g = buildPowerGraph(
      caps({ backupLoad: true }),
      powerFrom({ "load.power": 1500 }),
      "landscape",
      () => true,
      { power: 1800, connected: true, charging: true, subtractFromHome: true }, // ev > load (skew)
    );
    expect(g.nodes.find((n) => n.kind === "load")?.value).toBe(0);
  });

  test("charger needs a visible load node to branch from", () => {
    const noLoad = buildPowerGraph(
      caps({ grid: true }),
      () => undefined,
      "landscape",
      () => true,
      { power: 1800, connected: true, charging: true, subtractFromHome: false },
    );
    expect(noLoad.nodes.some((n) => n.kind === "charger")).toBe(false);
    const hiddenLoad = buildPowerGraph(
      caps({ backupLoad: true }),
      () => undefined,
      "landscape",
      hidden(["load.power"]),
      { power: 1800, connected: true, charging: true, subtractFromHome: false },
    );
    expect(hiddenLoad.nodes.some((n) => n.kind === "charger")).toBe(false);
  });

  test("plugged-in but not charging charger idles", () => {
    const g = buildPowerGraph(
      caps({ backupLoad: true }),
      powerFrom({ "load.power": 900 }),
      "portrait",
      () => true,
      { power: 0, connected: true, charging: false, subtractFromHome: false },
    );
    const charger = g.nodes.find((n) => n.kind === "charger");
    expect(charger?.flow).toBe("idle");
  });

  test("a lone landscape PV string sits on the hub row, so its rail runs straight", () => {
    const g = buildPowerGraph(caps({ pvStrings: 1 }), powerFrom({ "pv.string.power#1": 500 }));
    expect(g.nodes[0].at.y).toBe(g.hub.y);
    expect(g.segments[0].pts).toHaveLength(2);
  });

  test("a lone portrait sink node is centred rather than pinned to the left edge", () => {
    const g = buildPowerGraph(
      caps({ backupLoad: true }),
      powerFrom({ "load.power": 900 }),
      "portrait",
    );
    expect(g.nodes.find((n) => n.id === "load")?.at.x).toBe(0.5);
  });

  test("no visible PV metric at all yields no PV node", () => {
    const g = buildPowerGraph(
      caps({ pvStrings: 1 }),
      () => undefined,
      "landscape",
      hidden(["pv.string.power#1", "pv.total.power"]),
    );
    expect(g.nodes.some((n) => n.kind === "pv")).toBe(false);
  });
});

describe("helpers", () => {
  // The direction/colour helpers are module-private; drive them through the graph
  // the battery node produces (signed reading → flow, state and hue).
  const batteryAt = (watts: number | undefined) =>
    buildPowerGraph(caps({ battery: true }), powerFrom({ "battery.power": watts })).nodes.find(
      (n) => n.id === "battery",
    );

  test("a signed reading within ±0.5 W reads as idle", () => {
    expect(batteryAt(0.4)?.flow).toBe("idle");
    expect(batteryAt(-0.4)?.flow).toBe("idle");
    expect(batteryAt(0.6)?.flow).toBe("in");
    expect(batteryAt(-0.6)?.flow).toBe("out");
    expect(batteryAt(undefined)?.flow).toBe("idle");
  });

  test("flow hues: arriving good, leaving warn, idle the rail colour", () => {
    expect(batteryAt(800)?.color).toBe("text-sign-good");
    expect(batteryAt(-800)?.color).toBe("text-sign-warn");
    expect(batteryAt(0)?.color).toBe("text-border");
    // Grid uses cost colours; an unknown reading falls back to the rail colour.
    const grid = buildPowerGraph(caps({ grid: true }), () => undefined);
    expect(grid.nodes.find((n) => n.id === "grid")?.color).toBe("text-border");
  });

  test("the battery ring still fades across the 0/30/60 stops", () => {
    // The ramp moved to ./sign-colors and now mixes tokens instead of baked
    // rgb() triples; sign-colors.test.ts owns the detail. This holds the shape
    // the diagram depends on: three stops, a fade between them, and a clamp.
    expect(socColor(0)).not.toBe(socColor(30));
    expect(socColor(30)).not.toBe(socColor(60));
    expect(socColor(15)).toContain("color-mix");
    expect(socColor(150)).toBe(socColor(100));
  });
});

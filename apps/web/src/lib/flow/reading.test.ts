// Ported from v3 (dev 780b4e2, lib/inverter/power-graph.test.ts) onto v5 roles: the reading is the
// `plant` device's values (ADR 14) and the loadpoints' `ev` roles (ADR 10), signs per ADR 4.
import { expect, test } from "bun:test";
import { ALL, graph, INVERTER, node, PLANT, STRINGS } from "./flow.harness.ts";
import { hubMetrics } from "./reading.ts";

function batteryAt(watts: number) {
  return node(graph({ plant: { "battery.power": watts } }), "battery");
}

test("battery sign follows ADR 4: positive charges, negative discharges", () => {
  const charging = node(graph({ plant: { "battery.power": 800 } }), "battery");
  expect(charging?.state).toBe("charging");
  expect(charging?.flow).toBe("out");
  const discharging = node(graph({ plant: { "battery.power": -800 } }), "battery");
  expect(discharging?.state).toBe("discharging");
  expect(discharging?.flow).toBe("in");
});

test("the battery carries its state of charge", () => {
  expect(node(graph({ plant: { "battery.power": 0, "battery.soc": 64 } }), "battery")?.soc).toBe(
    64,
  );
});

test("grid speaks cost through its colours: import rose-red, export teal", () => {
  const importing = node(graph({ plant: { "grid.power": 400 } }), "grid");
  expect(importing?.accent).toBe("var(--e-import)");
  expect(importing?.state).toBe("import");
  const exporting = node(graph({ plant: { "grid.power": -400 } }), "grid");
  expect(exporting?.accent).toBe("var(--e-export)");
  expect(exporting?.state).toBe("export");
});

test("each rail is drawn in its node's energy colour", () => {
  const g = graph({ plant: { ...ALL, "grid.power": -300, "ev.charge.power": 0 } });

  for (const s of g.segments) expect(s.color).toBe(node(g, s.id.replace(/-hub$/u, ""))!.accent);
  expect(node(g, "pv")?.accent).toBe("var(--e-solar)");
  expect(node(g, "battery")?.accent).toBe("var(--e-battery)");
  expect(node(g, "house")?.accent).toBe("var(--e-house)");
  expect(node(g, "ev")?.accent).toBe("var(--e-ev)");
});

test("every plant role yields its node", () => {
  const g = graph({
    strings: STRINGS.slice(0, 2),
    inverter: {
      "pv.string.power[1]": 0,
      "pv.string.power[2]": 0,
    },
    plant: ALL,
  });

  expect(g.nodes.map((n) => n.kind).toSorted()).toEqual([
    "battery",
    "generator",
    "grid",
    "load",
    "pv",
    "pv",
  ]);
  // Zero everywhere → everything idles.
  expect(g.segments.every((s) => s.flow === "idle")).toBe(true);
});

test("a role the plant does not publish has no node", () => {
  const { "generator.power": _, ...rest } = ALL;
  const g = graph({ plant: rest });
  const kinds = g.nodes.map((n) => n.kind);
  expect(kinds).not.toContain("generator");
  expect(kinds).toContain("battery");
  expect(g.segments.some((s) => s.id === "generator-hub")).toBe(false);
});

test("a string without a reading has no node; the others keep theirs", () => {
  const g = graph({
    strings: STRINGS,
    inverter: { "pv.string.power[1]": 500, "pv.string.power[3]": 300 },
  });

  expect(g.nodes.map((n) => n.id)).toEqual(["string-1", "string-3"]);
  expect(g.segments.map((s) => s.id)).toEqual(["string-1-hub", "string-3-hub"]);
});

test("no string reading at all falls back to the aggregate PV node", () => {
  const g = graph({ strings: STRINGS, plant: { "pv.power": 900 } });
  expect(g.nodes.map((n) => n.id)).toEqual(["pv"]);
});

test("a metered house load renders a house node", () => {
  const g = graph({ plant: { "load.power": 900, "grid.power": 900 } });
  expect(g.nodes.map((n) => n.kind)).toContain("load");
});

test("a negative house load reads as feeding in, flowing into the hub", () => {
  // An unmetered producer on the house net outweighs consumption.
  const g = graph({ plant: { "load.power": -640 } });
  const load = node(g, "house");
  expect(load?.value).toBe(-640);
  expect(load?.flow).toBe("in");
  expect(load?.state).toBe("feeding");
  expect(g.segments.find((s) => s.id === "house-hub")?.flow).toBe("in");
});

test("a positive house load still reads as consuming", () => {
  const load = node(graph({ plant: { "load.power": 640 } }), "house");
  expect(load?.flow).toBe("out");
  expect(load?.state).toBe("consuming");
});

test("no load.power, no house node", () => {
  const g = graph({ plant: { "grid.power": 0 } });
  expect(g.nodes.map((n) => n.kind)).not.toContain("load");
});

test("house = load − ev, the EV is a hub sibling, and they sum to the load", () => {
  // ADR 14: the house load is all consumption but the battery's, so the EV is inside it.
  const g = graph({
    plant: { "load.power": 2400, "ev.charge.power": 1800 },
    loadpoint: { "ev.charge.power": 1800, "ev.connected": 1, "ev.charging": 1 },
  });

  const charger = node(g, "ev");
  const load = node(g, "house");
  expect(load?.value).toBe(600);
  expect(charger?.value).toBe(1800);
  expect(charger?.state).toBe("charging");
  expect(g.segments.every((s) => s.pts.at(-1)?.x === g.hub.x && s.pts.at(-1)?.y === g.hub.y)).toBe(
    true,
  );
  expect((load?.value ?? 0) + (charger?.value ?? 0)).toBe(2400);
});

test("a transient-negative house clamps to 0", () => {
  const g = graph({ plant: { "load.power": 1500, "ev.charge.power": 1800 } });
  expect(node(g, "house")?.value).toBe(0);
});

test("the EV shows without a house meter", () => {
  const g = graph({ plant: { "ev.charge.power": 1800 } });
  expect(node(g, "ev")?.flow).toBe("out");
});

test("a plugged-in car that is not charging idles", () => {
  const g = graph(
    {
      plant: { "load.power": 900, "ev.charge.power": 0 },
      loadpoint: { "ev.charge.power": 0, "ev.connected": 1, "ev.charging": 0 },
    },
    "portrait",
  );

  expect(node(g, "ev")?.flow).toBe("idle");
  expect(node(g, "ev")?.state).toBe("plugged");
});

test("one loadpoint lends the EV node its vehicle's state of charge", () => {
  const g = graph({
    plant: { "ev.charge.power": 1800 },
    loadpoint: { "ev.charge.power": 1800, "ev.vehicle.soc": 41 },
  });

  expect(node(g, "ev")?.soc).toBe(41);
});

test("no PV role at all yields no PV node", () => {
  const g = graph({ strings: STRINGS, plant: { "load.power": 100 } });
  expect(g.nodes.some((n) => n.kind === "pv")).toBe(false);
});

test("a signed reading within ±0.5 W reads as idle", () => {
  expect(batteryAt(0.4)?.flow).toBe("idle");
  expect(batteryAt(-0.4)?.flow).toBe("idle");
  expect(batteryAt(-0.6)?.flow).toBe("in");
  expect(batteryAt(0.6)?.flow).toBe("out");
});

test("the hub shows DC in, and while it produces its efficiency and own use", () => {
  const values = { [PLANT]: { "pv.power": 4000 }, [INVERTER]: { "inverter.power": 3800 } };
  expect(hubMetrics(values)).toEqual({ dc: 4000, efficiency: 95, own: 200 });
});

test("an idle array or no AC reading leaves only DC in", () => {
  expect(hubMetrics({ [PLANT]: { "pv.power": 20 }, [INVERTER]: { "inverter.power": 0 } })).toEqual({
    dc: 20,
    efficiency: undefined,
    own: undefined,
  });
  expect(hubMetrics({ [PLANT]: { "pv.power": 4000 } }).efficiency).toBeUndefined();
});

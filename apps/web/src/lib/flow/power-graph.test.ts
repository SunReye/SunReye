// Ported from v3 (dev 780b4e2, lib/inverter/power-graph.test.ts): where the flow's nodes sit and
// how their rails run, in both orientations.
import { expect, test } from "bun:test";
import { ALL, graph, INVERTER, node, STRINGS } from "./flow.harness.ts";

test("no strings → single PV node from the plant's pv.power", () => {
  const g = graph({ plant: { "pv.power": 1200 } });
  expect(g.nodes.map((n) => n.id)).toEqual(["pv"]);
  expect(g.segments.map((s) => s.id)).toEqual(["pv-hub"]);
  expect(g.nodes[0]?.flow).toBe("in");
  expect(g.nodes[0]?.state).toBe("producing");
});

test("one node and one segment per pv string", () => {
  const g = graph({
    strings: STRINGS,
    inverter: { "pv.string.power[1]": 500, "pv.string.power[2]": 0, "pv.string.power[3]": 300 },
  });

  expect(g.nodes.map((n) => n.id)).toEqual(["string-1", "string-2", "string-3"]);
  expect(g.nodes.map((n) => n.label)).toEqual(["Süd", "Nord", "West"]);
  expect(g.nodes[1]?.flow).toBe("idle");
  // Multi-string landscape routes take the cubic S-curve (4 pts) into the hub,
  // except a string that already sits on the hub's row, which runs straight.
  expect(
    g.segments.every((s) => s.pts.length === 4 || (s.pts.length === 2 && s.pts[0]?.y === g.hub.y)),
  ).toBe(true);
});

test("strings that do not fit collapse into the one PV node, which counts them", () => {
  const g = graph(
    {
      strings: STRINGS,
      plant: { "pv.power": 800 },
      inverter: {
        "pv.string.power[1]": 500,
        "pv.string.power[2]": 0,
        "pv.string.power[3]": 300,
      },
    },
    "portrait",
    2,
  );

  expect(g.nodes.map((n) => n.id)).toEqual(["pv"]);
  expect(g.nodes[0]).toMatchObject({ value: 800, strings: 3 });
});

test("an estimated string carries the mark", () => {
  const g = graph({
    strings: STRINGS.slice(0, 2),
    inverter: { "pv.string.power[1]": 500, "pv.string.power[2]": 300 },
    estimated: { [INVERTER]: ["pv.string.power[2]"] },
  });

  expect(g.nodes.map((n) => n.estimated)).toEqual([false, true]);
});

test("orientation moves the grid: right of the hub in landscape, sink row in portrait", () => {
  const plant = { "grid.power": 400 };
  const landscape = graph({ plant });
  expect(node(landscape, "grid")?.at.x).toBeGreaterThan(landscape.hub.x);
  expect(node(landscape, "grid")?.at.y).toBe(landscape.hub.y);
  const portrait = graph({ plant }, "portrait");
  expect(node(portrait, "grid")?.at.y).toBeGreaterThan(portrait.hub.y);
});

test("portrait pv captions sit above their nodes, clear of the connectors", () => {
  const p = {
    strings: STRINGS.slice(0, 2),
    inverter: { "pv.string.power[1]": 500, "pv.string.power[2]": 300 },
  };

  expect(graph(p, "portrait").nodes.every((n) => n.labelSide === "above")).toBe(true);
  expect(graph(p, "landscape").nodes.every((n) => n.labelSide === "below")).toBe(true);
});

test("every segment ends at the hub in both orientations", () => {
  for (const orientation of ["landscape", "portrait"] as const) {
    const g = graph(
      {
        strings: STRINGS.slice(0, 2),
        inverter: { "pv.string.power[1]": 0, "pv.string.power[2]": 0 },
        plant: { ...ALL, "ev.charge.power": 0 },
      },
      orientation,
    );

    expect(g.segments.every((s) => s.pts.at(-1)?.x === g.hub.x)).toBe(true);
    expect(g.segments.every((s) => s.pts.at(-1)?.y === g.hub.y)).toBe(true);
  }
});

test("a lone landscape PV string sits on the hub row, so its rail runs straight", () => {
  const g = graph({ strings: STRINGS.slice(0, 1), inverter: { "pv.string.power[1]": 500 } });
  expect(g.nodes[0]?.at.y).toBe(g.hub.y);
  expect(g.segments[0]?.pts).toHaveLength(2);
});

test("a lone portrait sink node is centred rather than pinned to the left edge", () => {
  const g = graph({ plant: { "load.power": 900 } }, "portrait");
  expect(node(g, "house")?.at.x).toBe(0.5);
});

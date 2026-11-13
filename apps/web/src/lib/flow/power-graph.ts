// The schematic behind the 2D power flow (ADR 21). Ported from v3 (dev 780b4e2,
// lib/inverter/power-graph.ts) by way of the prototype: routing, anchors and orientation rules are
// v3's; every node and rail carries its one energy colour.
import type { FlowReading } from "./reading.ts";
import type {
  Flow,
  GraphNode,
  GraphPart,
  GraphSegment,
  NodeState,
  Orientation,
  PowerGraph,
  Pt,
} from "./schematic.ts";

// Anchors are fractions of the *safe box* (the hero minus the caption insets), so a node centre at
// y=0 or y=1 sits one caption stack away from the hero's edge and text never clips.
const HUBS: Record<Orientation, Pt> = {
  landscape: { x: 0.5, y: 0.44 },
  portrait: { x: 0.5, y: 0.5 },
};

const SOLAR = "var(--e-solar)";
const BATTERY = "var(--e-battery)";
const IMPORT = "var(--e-import)";
const EXPORT = "var(--e-export)";
const HOUSE = "var(--e-house)";
const EV = "var(--e-ev)";

type Sense = { readonly flow: Flow; readonly state: NodeState };

const IDLE: Sense = { flow: "idle", state: "idle" };

/** Direction of a signed reading, with a ±0.5 W dead band around zero. */
function sense(value: number | undefined, positive: Sense, negative: Sense): Sense {
  const v = value ?? 0;

  if (v > 0.5) return positive;

  if (v < -0.5) return negative;

  return IDLE;
}

/**
 * Evenly place `k` anchors along one axis inside [lo, hi], shrinking the span toward the centre
 * when there are few nodes so a pair doesn't hug the edges.
 */
function rowPositions(k: number, lo: number, hi: number): number[] {
  if (k <= 1) return [(lo + hi) / 2];
  const span = ((hi - lo) * (k - 1)) / k;
  const start = (lo + hi) / 2 - span / 2;

  return Array.from({ length: k }, (_, i) => start + (span * i) / (k - 1));
}

/**
 * Route a node above or below the hub: leaves the node along its own column and arrives
 * horizontally into the hub's side (quadratic), or straight when on the hub's column or row.
 */
function drop(from: Pt, hub: Pt): Pt[] {
  if (from.x === hub.x || from.y === hub.y) return [from, hub];

  return [from, { x: from.x, y: hub.y }, hub];
}

/** Route a node beside the hub (landscape PV strings): a cubic S-curve, or straight on the hub's row. */
function sweep(from: Pt, hub: Pt): Pt[] {
  if (from.y === hub.y) return [from, hub];
  const mx = (from.x + hub.x) / 2;

  return [from, { x: mx, y: from.y }, { x: mx, y: hub.y }, hub];
}

type PvSource = Pick<GraphNode, "id" | "label" | "strings" | "value" | "estimated">;

/**
 * The PV source nodes: one per string while they fit the box, else the one aggregate node, so six
 * strings on a phone never overlap.
 */
function pvSources(r: FlowReading, fit: number): PvSource[] {
  if (r.strings.length > 0 && r.strings.length <= fit)
    return r.strings.map((s) => ({
      id: s.id,
      label: s.label,
      value: s.watts,
      estimated: s.estimated,
    }));

  if (r.pvTotal === undefined && r.strings.length === 0) return [];
  const total = r.pvTotal ?? r.strings.reduce((t, s) => t + s.watts, 0);

  return [{ id: "pv", strings: r.strings.length, value: total, estimated: false }];
}

/** One entry of the sink and storage row below the hub. */
type BottomSpec = Omit<GraphNode, "at" | "labelSide">;

function batteryBottom(r: FlowReading): BottomSpec | null {
  if (r.battery === undefined) return null;

  const s = sense(
    r.battery,
    { flow: "out", state: "charging" },
    { flow: "in", state: "discharging" },
  );

  return {
    id: "battery",
    kind: "battery",
    value: r.battery,
    accent: BATTERY,
    soc: r.batterySoc,
    estimated: false,
    ...s,
  };
}

/** The EV draw is metered inside `load` (ADR 14): subtract it, clamped at zero. */
function loadBottom(r: FlowReading): BottomSpec | null {
  if (r.load === undefined) return null;
  const value = r.charger ? Math.max(0, r.load - r.charger.power) : r.load;
  // Negative when an unmetered producer on the house net outweighs consumption.
  const s = sense(value, { flow: "out", state: "consuming" }, { flow: "in", state: "feeding" });

  return { id: "house", kind: "house", value, accent: HOUSE, estimated: false, ...s };
}

function generatorBottom(r: FlowReading): BottomSpec | null {
  if (r.generator === undefined) return null;
  const s = sense(r.generator, { flow: "in", state: "running" }, { flow: "idle", state: "off" });

  return {
    id: "generator",
    kind: "generator",
    value: r.generator,
    accent: HOUSE,
    estimated: false,
    ...s,
  };
}

function chargerBottom(r: FlowReading): BottomSpec | null {
  const c = r.charger;

  if (!c) return null;
  const flow: Flow = c.power > 0.5 ? "out" : "idle";

  const state: NodeState =
    c.charging || flow === "out" ? "charging" : c.connected ? "plugged" : "idle";

  return {
    id: "ev",
    kind: "ev",
    value: c.power,
    flow,
    state,
    accent: EV,
    soc: c.soc,
    estimated: false,
  };
}

/** The grid speaks cost through its two colours: import rose-red, export teal. */
function gridRow(r: FlowReading): BottomSpec | null {
  if (r.grid === undefined) return null;
  const s = sense(r.grid, { flow: "in", state: "import" }, { flow: "out", state: "export" });

  return {
    id: "grid",
    kind: "grid",
    value: r.grid,
    accent: s.flow === "in" ? IMPORT : EXPORT,
    estimated: false,
    ...s,
  };
}

/** The sink row sits on the safe box's bottom edge. */
const BOTTOM_Y = 1;

/** PV anchors: a row along the top in portrait, stacked down the left edge in landscape. */
function pvAnchors(count: number, portrait: boolean, hubY: number): Pt[] {
  if (portrait) return rowPositions(count, 0.02, 0.98).map((x) => ({ x, y: 0 }));
  const ys = count === 1 ? [hubY] : rowPositions(count, 0.02, 0.78);

  return ys.map((y) => ({ x: 0, y }));
}

function pvGraph(r: FlowReading, portrait: boolean, hub: Pt, fit: number): GraphPart {
  const pv = pvSources(r, fit);
  const anchors = pvAnchors(pv.length, portrait, hub.y);
  const nodes: GraphNode[] = [];
  const segments: GraphSegment[] = [];
  pv.forEach((p, i) => {
    const s = sense(p.value, { flow: "in", state: "producing" }, IDLE);
    const at = anchors[i]!;
    nodes.push({
      ...p,
      kind: "pv",
      accent: SOLAR,
      at,
      labelSide: portrait ? "above" : "below",
      ...s,
    });
    segments.push({
      id: `${p.id}-hub`,
      flow: s.flow,
      value: p.value,
      color: SOLAR,
      pts: portrait ? drop(at, hub) : sweep(at, hub),
    });
  });

  return { nodes, segments };
}

/** X anchors for the sink row: the full safe box in portrait, inset in landscape to clear the spine. */
function bottomXs(count: number, portrait: boolean): number[] {
  if (!portrait) return rowPositions(count, 0.16, 0.84);

  if (count === 1) return [0.5];

  return Array.from({ length: count }, (_, i) => i / (count - 1));
}

function bottomGraph(bottoms: readonly BottomSpec[], portrait: boolean, hub: Pt): GraphPart {
  const xs = bottomXs(bottoms.length, portrait);
  const nodes: GraphNode[] = [];
  const segments: GraphSegment[] = [];
  bottoms.forEach((b, i) => {
    const at = { x: xs[i]!, y: BOTTOM_Y };
    nodes.push({ ...b, at, labelSide: "below" });
    segments.push({
      id: `${b.id}-hub`,
      flow: b.flow,
      value: b.value,
      color: b.accent,
      pts: drop(at, hub),
    });
  });

  return { nodes, segments };
}

/** In landscape the grid takes the right end of the spine instead of the sink row. */
function landscapeGrid(grid: BottomSpec | null, portrait: boolean, hub: Pt): GraphPart {
  if (!grid || portrait) return { nodes: [], segments: [] };
  const at = { x: 1, y: hub.y };

  return {
    nodes: [{ ...grid, at, labelSide: "below" }],
    segments: [
      { id: "grid-hub", flow: grid.flow, value: grid.value, color: grid.accent, pts: [at, hub] },
    ],
  };
}

/**
 * Build the schematic from one reading. Pure. `fit` is how many PV strings the box can hold side
 * by side (portrait) or stacked (landscape) before they collapse into the aggregate node.
 */
export function buildPowerGraph(
  r: FlowReading,
  orientation: Orientation = "landscape",
  fit = 6,
): PowerGraph {
  const hub = HUBS[orientation];
  const portrait = orientation === "portrait";
  const grid = gridRow(r);

  const bottoms = [
    batteryBottom(r),
    portrait ? grid : null,
    loadBottom(r),
    chargerBottom(r),
    generatorBottom(r),
  ].filter((b): b is BottomSpec => b !== null);

  const parts = [
    pvGraph(r, portrait, hub, fit),
    bottomGraph(bottoms, portrait, hub),
    landscapeGrid(grid, portrait, hub),
  ];

  return { hub, nodes: parts.flatMap((p) => p.nodes), segments: parts.flatMap((p) => p.segments) };
}

/** A rail's anchors in the measured box as an SVG path: 2 pts line, 3 quadratic, 4 cubic. */
export function railPath(pts: readonly Pt[], width: number, height: number): string {
  const c = pts.map((p) => `${p.x * width} ${p.y * height}`);

  if (pts.length === 4) return `M ${c[0]} C ${c[1]}, ${c[2]}, ${c[3]}`;

  if (pts.length === 3) return `M ${c[0]} Q ${c[1]}, ${c[2]}`;

  return `M ${c[0]} L ${c[1]}`;
}

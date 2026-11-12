// The schematic behind the 2D power flow. Ported from v3 (dev 780b4e2, lib/inverter/power-graph.ts):
// the routing, anchors and orientation rules are v3's. What changed for the prototype: the input is a
// plain reading instead of role lookups, labels are inline, and every node and rail carries its one
// energy colour (ADR 21) instead of v3's direction colours.

// Flow relative to the inverter: `in` = power arriving (production, discharge, import),
// `out` = leaving it (load, charge, export).
export type Flow = "in" | "out" | "idle";
/** Anchor as a fraction (0..1) of the diagram's safe box; node anchors are box centres. */
export type Pt = { x: number; y: number };

/**
 * Diagram shape, picked from the rendered box's aspect ratio: `portrait` stacks sources above the
 * hub and sinks below; `landscape` fans sources in from the left and the grid from the right.
 */
export type Orientation = "landscape" | "portrait";

export type NodeKind = "pv" | "battery" | "load" | "generator" | "grid" | "charger";

/** What the plant reports right now, in watts. A missing field is a role the plant does not have. */
export interface FlowReading {
  strings: { id: string; label: string; watts: number | undefined }[];
  /** Total DC in; the aggregate PV node shows it when the strings do not fit. */
  pvTotal?: number | undefined;
  /** > 0 discharging (in), < 0 charging (out). */
  battery?: number | undefined;
  /** > 0 importing (in), < 0 exporting (out). */
  grid?: number | undefined;
  /** House consumption, EV draw included. */
  load?: number | undefined;
  generator?: number | undefined;
  charger?: ChargerDatum | undefined;
}

/**
 * The EV draw is part of `load`. Two display models:
 * - `subtractFromHome = false`: the charger hangs off the house node as an informational
 *   sub-branch and the house keeps its full value. Correct for any wiring.
 * - `subtractFromHome = true`: the house node becomes `load − ev` and the EV is a sibling with its
 *   own hub rail. Only correct when the charger is metered inside `load`.
 */
export type ChargerDatum = {
  power: number;
  connected: boolean;
  charging: boolean;
  subtractFromHome: boolean;
};

export type GraphNode = {
  id: string;
  label: string;
  kind: NodeKind;
  value: number | undefined;
  flow: Flow;
  state: string;
  /** The node's energy colour, a CSS colour value. */
  accent: string;
  at: Pt;
  /** Where the caption sits so it never collides with the node's rail. */
  labelSide: "above" | "below";
};

export type GraphSegment = {
  id: string;
  flow: Flow;
  value: number | undefined;
  /** The rail's energy colour, a CSS colour value. */
  color: string;
  /** 2 pts = straight line, 3 = quadratic Bézier, 4 = cubic Bézier; pts[last] is the hub. */
  pts: Pt[];
};

export type PowerGraph = { hub: Pt; nodes: GraphNode[]; segments: GraphSegment[] };
type GraphPart = { nodes: GraphNode[]; segments: GraphSegment[] };

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

type Sense = { flow: Flow; state: string };
const IDLE: Sense = { flow: "idle", state: "Ruht" };

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

/**
 * The PV source nodes: one per string while they fit the box, else the one aggregate node, so six
 * strings on a phone never overlap.
 */
function pvSources(r: FlowReading, fit: number): { id: string; label: string; value: number | undefined }[] {
  if (r.strings.length > 0 && r.strings.length <= fit) return r.strings.map((s) => ({ id: s.id, label: s.label, value: s.watts }));
  if (r.pvTotal === undefined && r.strings.length === 0) return [];
  const total = r.pvTotal ?? r.strings.reduce((t, s) => t + (s.watts ?? 0), 0);
  return [{ id: "solar", label: r.strings.length > 1 ? `PV · ${r.strings.length} Strings` : "PV", value: total }];
}

/** One entry of the sink and storage row below the hub. */
type BottomSpec = Omit<GraphNode, "at" | "labelSide">;

function batteryBottom(r: FlowReading): BottomSpec | null {
  if (r.battery === undefined) return null;
  const s = sense(r.battery, { flow: "in", state: "Entlädt" }, { flow: "out", state: "Lädt" });
  return { id: "battery", label: "Batterie", kind: "battery", value: r.battery, accent: BATTERY, ...s };
}

/** In residual-home mode the EV draw is metered inside `load`: subtract it, clamped at zero. */
function loadBottom(r: FlowReading): BottomSpec | null {
  if (r.load === undefined) return null;
  const value = r.charger?.subtractFromHome ? Math.max(0, r.load - r.charger.power) : r.load;
  // Negative when an unmetered producer on the house net outweighs consumption.
  const s = sense(value, { flow: "out", state: "Verbraucht" }, { flow: "in", state: "Speist ein" });
  return { id: "house", label: "Haus", kind: "load", value, accent: HOUSE, ...s };
}

function generatorBottom(r: FlowReading): BottomSpec | null {
  if (r.generator === undefined) return null;
  const s = sense(r.generator, { flow: "in", state: "Läuft" }, { flow: "idle", state: "Aus" });
  return { id: "generator", label: "Generator", kind: "generator", value: r.generator, accent: HOUSE, ...s };
}

function chargerBottom(r: FlowReading): BottomSpec | null {
  const c = r.charger;
  if (!c || r.load === undefined) return null;
  const flow: Flow = c.power > 0.5 ? "out" : "idle";
  const state = c.charging ? "Lädt" : c.connected ? "Angesteckt" : "Ruht";
  return { id: "ev", label: "Auto", kind: "charger", value: c.power, flow, state, accent: EV };
}

/** The grid speaks cost through its two colours: import rose-red, export teal. */
function gridRow(r: FlowReading): BottomSpec | null {
  if (r.grid === undefined) return null;
  const s = sense(r.grid, { flow: "in", state: "Bezug" }, { flow: "out", state: "Einspeisung" });
  return { id: "grid", label: "Netz", kind: "grid", value: r.grid, accent: s.flow === "in" ? IMPORT : EXPORT, ...s };
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
    const s = sense(p.value, { flow: "in", state: "Erzeugt" }, IDLE);
    const at = anchors[i]!;
    nodes.push({ ...p, kind: "pv", accent: SOLAR, at, labelSide: portrait ? "above" : "below", ...s });
    segments.push({ id: `${p.id}-hub`, flow: s.flow, value: p.value, color: SOLAR, pts: portrait ? drop(at, hub) : sweep(at, hub) });
  });
  return { nodes, segments };
}

/** X anchors for the sink row: the full safe box in portrait, inset in landscape to clear the spine. */
function bottomXs(count: number, portrait: boolean): number[] {
  if (!portrait) return rowPositions(count, 0.16, 0.84);
  if (count === 1) return [0.5];
  return Array.from({ length: count }, (_, i) => i / (count - 1));
}

function bottomGraph(bottoms: BottomSpec[], portrait: boolean, hub: Pt, evAsSubBranch: boolean): GraphPart {
  const xs = bottomXs(bottoms.length, portrait);
  const loadAt = { x: xs[bottoms.findIndex((b) => b.id === "house")] ?? hub.x, y: BOTTOM_Y };
  const nodes: GraphNode[] = [];
  const segments: GraphSegment[] = [];
  bottoms.forEach((b, i) => {
    const at = { x: xs[i]!, y: BOTTOM_Y };
    nodes.push({ ...b, at, labelSide: "below" });
    // An informational charger runs to the house node: its draw is inside `load`, so a hub rail
    // would count it twice.
    const toLoad = b.id === "ev" && evAsSubBranch;
    segments.push({
      id: toLoad ? "house-ev" : `${b.id}-hub`,
      flow: b.flow,
      value: b.value,
      color: b.accent,
      pts: toLoad ? [at, loadAt] : drop(at, hub),
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
    segments: [{ id: "grid-hub", flow: grid.flow, value: grid.value, color: grid.accent, pts: [at, hub] }],
  };
}

/**
 * Build the schematic from one reading. Pure. `fit` is how many PV strings the box can hold side
 * by side (portrait) or stacked (landscape) before they collapse into the aggregate node.
 */
export function buildPowerGraph(r: FlowReading, orientation: Orientation = "landscape", fit = 6): PowerGraph {
  const hub = HUBS[orientation];
  const portrait = orientation === "portrait";
  const grid = gridRow(r);
  const bottoms = [batteryBottom(r), portrait ? grid : null, loadBottom(r), chargerBottom(r), generatorBottom(r)].filter(
    (b): b is BottomSpec => b !== null,
  );
  const evAsSubBranch = Boolean(r.charger && !r.charger.subtractFromHome && r.load !== undefined);
  const parts = [pvGraph(r, portrait, hub, fit), bottomGraph(bottoms, portrait, hub, evAsSubBranch), landscapeGrid(grid, portrait, hub)];
  return { hub, nodes: parts.flatMap((p) => p.nodes), segments: parts.flatMap((p) => p.segments) };
}

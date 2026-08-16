import { flowClass, gridClass, type Flow } from "./sign-colors";
import type { CanonicalRole, InverterCapabilities } from "$lib/inverter/types";
import * as m from "$lib/paraglide/messages";

// Flow relative to the inverter: `in` = power arriving (production / discharge
// / import), `out` = leaving it (load / charge / export).
// Declared with the colours that read it — see ./sign-colors.
export type { Flow };
/** Anchor as a fraction (0..1) of the diagram box — node anchors are circle centres. */
export type Pt = { x: number; y: number };

/**
 * Diagram shape, picked from the rendered box's aspect ratio: `portrait`
 * stacks sources above the hub and sinks below (phones, narrow panels);
 * `landscape` fans sources in from the left and the grid from the right
 * (tablets, desktops, wall displays).
 */
export type Orientation = "landscape" | "portrait";

/** What the node represents; the component maps this to an icon. */
export type NodeKind = "pv" | "battery" | "load" | "generator" | "grid" | "charger";

/**
 * Live EV-charger data (from the EVCC store). Injected as plain data so the
 * builder stays pure — it is *not* an inverter role.
 *
 * The EV draw is part of the inverter's `load.power`. Two display models:
 * - `subtractFromHome = false` (default): the charger hangs off the load node as
 *   an informational sub-branch; the load node keeps its full value. Correct for
 *   any wiring (never double-counts on the spine).
 * - `subtractFromHome = true`: the load node becomes "Home" = `load − ev` and the
 *   EV is a sibling node with its own hub rail. Only correct when the charger is
 *   actually metered inside `load.power` (wired on the inverter's load output).
 */
export type ChargerDatum = {
  /** Aggregated charge power across loadpoints, W. */
  power: number;
  /** Vehicle state of charge (0..100) when a single vehicle is known. */
  soc?: number;
  /** Vehicle plugged in. */
  connected: boolean;
  charging: boolean;
  /** Subtract the EV draw from the load node and split it out (see above). */
  subtractFromHome: boolean;
};

export type GraphNode = {
  id: string;
  label: string;
  kind: NodeKind;
  value: number | undefined;
  flow: Flow;
  state: string;
  accent: string;
  /** Tailwind text-* class for the flow hue (defaults to {@link flowColor}). */
  color: string;
  at: Pt;
  /** Where the caption sits so it never collides with the node's connector. */
  labelSide: "above" | "below";
};

export type GraphSegment = {
  id: string;
  type: "DC" | "AC";
  flow: Flow;
  value: number | undefined;
  color: string;
  /** 2 pts = straight line, 3 = quadratic Bézier, 4 = cubic Bézier; pts[last] is the hub. */
  pts: Pt[];
};

export type PowerGraph = { hub: Pt; nodes: GraphNode[]; segments: GraphSegment[] };

/** Live watts for a canonical role, or undefined when unavailable. */
type PowerLookup = (role: CanonicalRole, index?: number) => number | undefined;
/** Whether a role's driving metric is *visible* (Settings → Sensors). */
type VisibleLookup = (role: CanonicalRole, index?: number) => boolean;
/** A slice of the graph, concatenated in render order by {@link buildPowerGraph}. */
type GraphPart = { nodes: GraphNode[]; segments: GraphSegment[] };

// Anchors are fractions of the *safe box* — the hero minus the component's
// caption insets — so a node centre at y=0/y=1 sits exactly one caption-stack
// away from the hero's edge and text can never clip, however short the box.
const HUBS: Record<Orientation, Pt> = {
  landscape: { x: 0.5, y: 0.44 },
  portrait: { x: 0.5, y: 0.5 },
};

/** Direction of a signed reading, with a ±0.5 W dead band around zero. */
function sense(
  value: number | undefined,
  positive: { flow: Flow; state: string },
  negative: { flow: Flow; state: string },
): { flow: Flow; state: string } {
  const v = value ?? 0;
  if (v > 0.5) return positive;
  if (v < -0.5) return negative;
  return { flow: "idle", state: m.flow_idle() };
}

// Direction, cost and battery-health colours live in ./sign-colors, where they
// are tokens rather than Tailwind literals and can be exercised.
const flowColor = flowClass;
const gridColor = gridClass;

/**
 * Evenly place `k` anchors along one axis inside [lo, hi], shrinking the span
 * toward the centre when there are few nodes so a pair doesn't hug the edges.
 */
function rowPositions(k: number, lo: number, hi: number): number[] {
  if (k <= 1) return [(lo + hi) / 2];
  const span = ((hi - lo) * (k - 1)) / k;
  const start = (lo + hi) / 2 - span / 2;
  return Array.from({ length: k }, (_, i) => start + (span * i) / (k - 1));
}

/**
 * Route a node above/below the hub: leaves the node along its own column and
 * arrives horizontally into the hub's side (quadratic), or straight when the
 * node sits on the hub's column or row.
 */
function drop(from: Pt, hub: Pt): Pt[] {
  if (from.x === hub.x || from.y === hub.y) return [from, hub];
  return [from, { x: from.x, y: hub.y }, hub];
}

/**
 * Route a node beside the hub (landscape PV strings): a cubic S-curve that
 * leaves and arrives horizontally, or straight when already on the hub's row.
 */
function sweep(from: Pt, hub: Pt): Pt[] {
  if (from.y === hub.y) return [from, hub];
  const mx = (from.x + hub.x) / 2;
  return [from, { x: mx, y: from.y }, { x: mx, y: hub.y }, hub];
}

/**
 * The visible PV source nodes: one per *visible* PV string (hiding a string's
 * power metric drops it). With no per-string capability (or every string
 * hidden), fall back to the aggregate solar node when it's visible, else no
 * PV source at all.
 */
function pvSources(
  count: number,
  power: PowerLookup,
  has: VisibleLookup,
): { id: string; label: string; value: number | undefined }[] {
  const strings = Array.from({ length: count }, (_, i) => i + 1)
    .filter((idx) => has("pv.string.power", idx))
    .map((idx) => ({
      id: `pv${idx}`,
      label: `${m.label_string()} ${idx}`,
      value: power("pv.string.power", idx),
    }));
  if (strings.length > 0) return strings;
  if (!has("pv.total.power")) return [];
  return [{ id: "solar", label: m.label_solar(), value: power("pv.total.power") }];
}

/** One entry of the sink/storage row below the hub. */
type BottomSpec = {
  id: string;
  label: string;
  kind: NodeKind;
  type: "DC" | "AC";
  value: number | undefined;
  flow: Flow;
  state: string;
  accent: string;
  color: string;
};

/**
 * The load node's value + label. In residual-home mode the EV draw is metered
 * inside `load.power`, so subtract it and label the node "Home"; the two figures
 * come from independent samples, so clamp the transient-negative case to 0.
 */
function homeBottom(
  loadW: number | undefined,
  charger: ChargerDatum | undefined,
): { value: number | undefined; label: string } {
  if (charger?.subtractFromHome && loadW !== undefined) {
    return { value: Math.max(0, loadW - charger.power), label: m.label_home() };
  }
  return { value: loadW, label: m.label_load() };
}

/** The battery bottom-row entry, or null when absent/hidden. */
function batteryBottom(
  caps: InverterCapabilities | null,
  power: PowerLookup,
  has: VisibleLookup,
): BottomSpec | null {
  if (!caps?.battery || !has("battery.power")) return null;
  const v = power("battery.power");
  // Sign convention (Deye register 590): power > 0 discharging (in), < 0 charging (out).
  const s = sense(
    v,
    { flow: "in", state: m.flow_discharging() },
    { flow: "out", state: m.flow_charging() },
  );
  return {
    id: "battery",
    label: m.label_battery(),
    kind: "battery",
    type: "DC",
    value: v,
    accent: "var(--energy-battery)",
    color: flowColor(s.flow),
    ...s,
  };
}

/** Whether the load node renders: capability present *and* its metric visible. */
function loadVisible(caps: InverterCapabilities | null, has: VisibleLookup): boolean {
  return Boolean(caps?.backupLoad) && has("load.power");
}

/** The load/home bottom-row entry, or null when absent/hidden. */
function loadBottom(
  caps: InverterCapabilities | null,
  power: PowerLookup,
  has: VisibleLookup,
  charger: ChargerDatum | undefined,
): BottomSpec | null {
  if (!loadVisible(caps, has)) return null;
  const { value, label } = homeBottom(power("load.power"), charger);
  const s = sense(
    value,
    { flow: "out", state: m.flow_consuming() },
    { flow: "out", state: m.flow_consuming() },
  );
  return {
    id: "load",
    label,
    kind: "load",
    type: "AC",
    value,
    accent: "var(--energy-load)",
    color: flowColor(s.flow),
    ...s,
  };
}

/** The generator bottom-row entry, or null when absent/hidden. */
function generatorBottom(
  caps: InverterCapabilities | null,
  power: PowerLookup,
  has: VisibleLookup,
): BottomSpec | null {
  if (!caps?.generator || !has("generator.power")) return null;
  const v = power("generator.power");
  const s = sense(
    v,
    { flow: "in", state: m.flow_running() },
    { flow: "idle", state: m.flow_off() },
  );
  return {
    id: "generator",
    label: m.label_generator(),
    kind: "generator",
    type: "AC",
    value: v,
    accent: "var(--energy-generator)",
    color: flowColor(s.flow),
    ...s,
  };
}

/** The EV charger's bottom-row entry (state text mirrors EVCC's semantics). */
function chargerRow(charger: ChargerDatum): BottomSpec {
  const flow: Flow = charger.power > 0.5 ? "out" : "idle";
  const state = charger.charging
    ? m.flow_charging()
    : charger.connected
      ? m.flow_plugged()
      : m.flow_idle();
  return {
    id: "charger",
    label: m.label_ev(),
    kind: "charger",
    type: "AC",
    value: charger.power,
    flow,
    state,
    accent: "var(--energy-ev)",
    color: flowColor(flow),
  };
}

/**
 * The charger's bottom-row entry, or null when there is no charger or no visible
 * load node for it to belong to.
 */
function chargerBottom(
  caps: InverterCapabilities | null,
  has: VisibleLookup,
  charger: ChargerDatum | undefined,
): BottomSpec | null {
  if (!charger || !loadVisible(caps, has)) return null;
  return chargerRow(charger);
}

/**
 * Informational mode: the EV hangs off the load node rather than the hub, because
 * its draw is already inside `load.power` and a hub rail would double-count it.
 * Residual-home mode makes it a real sibling with its own rail.
 */
function evIsSubBranch(
  caps: InverterCapabilities | null,
  has: VisibleLookup,
  charger: ChargerDatum | undefined,
): boolean {
  if (!charger || charger.subtractFromHome) return false;
  return loadVisible(caps, has);
}

/** Grid presence, reading and flow sense — shared by both orientations. */
type GridSpec = { visible: boolean; value: number | undefined; flow: Flow; state: string };

function gridSpec(
  caps: InverterCapabilities | null,
  power: PowerLookup,
  has: VisibleLookup,
): GridSpec {
  const visible = Boolean(caps?.grid) && has("grid.power");
  const value = visible ? power("grid.power") : undefined;
  const s = sense(
    value,
    { flow: "in", state: m.flow_importing() },
    { flow: "out", state: m.flow_exporting() },
  );
  return { visible, value, ...s };
}

/** The grid's row shape (ungated) — cost colours, not raw flow direction. */
function gridRow(g: GridSpec): BottomSpec {
  return {
    id: "grid",
    label: m.label_grid(),
    kind: "grid",
    type: "AC",
    value: g.value,
    accent: "var(--energy-grid)",
    color: gridColor(g.value),
    flow: g.flow,
    state: g.state,
  };
}

/** The grid joins the sink row in portrait only; landscape gives it the spine's end. */
function gridBottom(g: GridSpec, portrait: boolean): BottomSpec | null {
  return g.visible && portrait ? gridRow(g) : null;
}

/**
 * A bottom-row node's rail to the hub — except an informational-mode charger,
 * which runs to the load node instead (its draw is inside `load.power`, so a hub
 * rail would double-count it). In residual-home mode the EV is a real sibling and
 * takes a normal hub rail like any other node.
 */
function bottomSegment(
  b: BottomSpec,
  at: Pt,
  hub: Pt,
  loadAt: Pt,
  evAsSubBranch: boolean,
): GraphSegment {
  const toLoad = b.id === "charger" && evAsSubBranch;
  return {
    id: toLoad ? "load-charger" : `${b.id}-hub`,
    type: b.type,
    flow: b.flow,
    value: b.value,
    color: b.color,
    pts: toLoad ? [at, loadAt] : drop(at, hub),
  };
}

const SOLAR_ACCENT = "var(--energy-solar)";
/** The sink row sits on the safe box's bottom edge. */
const BOTTOM_Y = 1;

/**
 * Anchors for the PV source row: a row along the top in portrait (captions above,
 * clear of the connectors), stacked down the left edge in landscape — where a lone
 * string sits on the hub's row so its rail runs straight.
 */
function pvAnchors(count: number, portrait: boolean, hubY: number): Pt[] {
  if (portrait) return rowPositions(count, 0.02, 0.98).map((x) => ({ x, y: 0 }));
  const ys = count === 1 ? [hubY] : rowPositions(count, 0.02, 0.78);
  return ys.map((y) => ({ x: 0, y }));
}

/** Nodes + rails for the visible PV sources (strings, or the aggregate). */
function pvGraph(
  caps: InverterCapabilities | null,
  power: PowerLookup,
  has: VisibleLookup,
  portrait: boolean,
  hub: Pt,
): GraphPart {
  const pv = pvSources(caps?.pvStrings ?? 0, power, has);
  const anchors = pvAnchors(pv.length, portrait, hub.y);
  const nodes: GraphNode[] = [];
  const segments: GraphSegment[] = [];
  pv.forEach((p, i) => {
    const s = sense(
      p.value,
      { flow: "in", state: m.flow_producing() },
      { flow: "idle", state: m.flow_idle() },
    );
    const at = anchors[i];
    nodes.push({
      ...p,
      kind: "pv",
      accent: SOLAR_ACCENT,
      color: flowColor(s.flow),
      at,
      labelSide: portrait ? "above" : "below",
      ...s,
    });
    segments.push({
      id: `${p.id}-hub`,
      type: "DC",
      flow: s.flow,
      value: p.value,
      color: flowColor(s.flow),
      pts: portrait ? drop(at, hub) : sweep(at, hub),
    });
  });
  return { nodes, segments };
}

/**
 * The sink/storage row below the hub, in display order. Each builder decides for
 * itself whether it belongs in the row, so adding a node is one entry here.
 */
function collectBottoms(
  caps: InverterCapabilities | null,
  power: PowerLookup,
  has: VisibleLookup,
  grid: GridSpec,
  portrait: boolean,
  charger: ChargerDatum | undefined,
): BottomSpec[] {
  return [
    batteryBottom(caps, power, has),
    gridBottom(grid, portrait),
    loadBottom(caps, power, has, charger),
    chargerBottom(caps, has, charger),
    generatorBottom(caps, power, has),
  ].filter((b): b is BottomSpec => b !== null);
}

/**
 * X anchors for the sink row. Portrait spreads it across the full safe box —
 * phones need every pixel of width; the caption insets already keep the outermost
 * captions legal. Landscape insets the row so it clears the spine's ends.
 */
function bottomXs(count: number, portrait: boolean): number[] {
  if (!portrait) return rowPositions(count, 0.16, 0.84);
  if (count === 1) return [0.5];
  return Array.from({ length: count }, (_, i) => i / (count - 1));
}

/** Nodes + rails for the sink/storage row. */
function bottomGraph(
  bottoms: BottomSpec[],
  portrait: boolean,
  hub: Pt,
  evAsSubBranch: boolean,
): GraphPart {
  const xs = bottomXs(bottoms.length, portrait);
  const loadAt = { x: xs[bottoms.findIndex((b) => b.id === "load")], y: BOTTOM_Y };
  const nodes: GraphNode[] = [];
  const segments: GraphSegment[] = [];
  bottoms.forEach((b, i) => {
    const at = { x: xs[i], y: BOTTOM_Y };
    const { type: _type, ...node } = b;
    nodes.push({ ...node, at, labelSide: "below" });
    segments.push(bottomSegment(b, at, hub, loadAt, evAsSubBranch));
  });
  return { nodes, segments };
}

/** In landscape the grid takes the right end of the spine instead of the sink row. */
function landscapeGrid(g: GridSpec, portrait: boolean, hub: Pt): GraphPart {
  if (!g.visible || portrait) return { nodes: [], segments: [] };
  const at = { x: 1, y: hub.y };
  const { type, ...node } = gridRow(g);
  return {
    nodes: [{ ...node, at, labelSide: "below" }],
    segments: [
      { id: "grid-hub", type, flow: g.flow, value: g.value, color: node.color, pts: [at, hub] },
    ],
  };
}

/**
 * Build the schematic graph for the power-flow diagram from the profile's
 * capabilities and a live power lookup. Pure — the caller injects `power`
 * (role → watts) so this stays free of the inverter store singleton.
 *
 * `has(role, index)` reports whether the driving metric is *visible* — the
 * caller backs it with the filtered `byRole`, so a metric hidden via Settings →
 * Sensors drops its node/segment (a whole group, or a single PV string). It
 * defaults to always-visible so non-UI callers (tests) keep the caps-only
 * shape. Capabilities stay server-derived and never flip on hiding, so presence
 * is `caps` *and* a visible metric.
 */
export function buildPowerGraph(
  caps: InverterCapabilities | null,
  power: (role: CanonicalRole, index?: number) => number | undefined,
  orientation: Orientation = "landscape",
  has: (role: CanonicalRole, index?: number) => boolean = () => true,
  charger?: ChargerDatum,
): PowerGraph {
  const hub = HUBS[orientation];
  const portrait = orientation === "portrait";
  const grid = gridSpec(caps, power, has);
  const bottoms = collectBottoms(caps, power, has, grid, portrait, charger);
  const parts = [
    pvGraph(caps, power, has, portrait, hub),
    bottomGraph(bottoms, portrait, hub, evIsSubBranch(caps, has, charger)),
    landscapeGrid(grid, portrait, hub),
  ];
  return {
    hub,
    nodes: parts.flatMap((p) => p.nodes),
    segments: parts.flatMap((p) => p.segments),
  };
}

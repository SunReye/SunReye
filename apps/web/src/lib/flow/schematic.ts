// The 2D power flow's schematic (ADR 21): nodes, rails and their anchors in the safe box.
import type { EquipmentKind } from "../equipment-kinds.ts";
import type { RailPulse } from "./flow-pulse.ts";

// Flow relative to the inverter: `in` = power arriving (production, discharge, import),
// `out` = leaving it (load, charge, export).
export type Flow = "in" | "out" | "idle";

/** Anchor as a fraction (0..1) of the diagram's safe box; node anchors are box centres. */
export type Pt = { readonly x: number; readonly y: number };

/**
 * Diagram shape, picked from the rendered box's aspect ratio: `portrait` stacks sources above the
 * hub and sinks below; `landscape` fans sources in from the left and the grid from the right.
 */
export type Orientation = "landscape" | "portrait";

export type NodeKind = Extract<
  EquipmentKind,
  "pv" | "battery" | "house" | "generator" | "grid" | "ev"
>;

/** What a node is doing, worded by the view. */
export type NodeState =
  | "idle"
  | "producing"
  | "charging"
  | "discharging"
  | "consuming"
  | "feeding"
  | "running"
  | "off"
  | "import"
  | "export"
  | "plugged";

export type GraphNode = {
  /** The detail figure it opens (ADR 21). */
  readonly id: string;
  /** A string's name; the view names the other kinds. */
  readonly label?: string | undefined;
  /** How many strings the aggregate PV node stands for. */
  readonly strings?: number | undefined;
  readonly kind: NodeKind;
  readonly value: number | undefined;
  readonly flow: Flow;
  readonly state: NodeState;
  /** The node's energy colour, a CSS colour value. */
  readonly accent: string;
  readonly at: Pt;
  /** Where the caption sits so it never collides with the node's rail. */
  readonly labelSide: "above" | "below";
  readonly soc?: number | undefined;
  /** Split from its MPPT input's power, not measured (ADR 17). */
  readonly estimated: boolean;
};

export type GraphSegment = {
  readonly id: string;
  readonly flow: Flow;
  readonly value: number | undefined;
  /** The rail's energy colour, a CSS colour value. */
  readonly color: string;
  /** 2 pts = straight line, 3 = quadratic Bézier, 4 = cubic Bézier; pts[last] is the hub. */
  readonly pts: readonly Pt[];
};

/** Some of a graph's nodes and their rails. */
export type GraphPart = {
  readonly nodes: readonly GraphNode[];
  readonly segments: readonly GraphSegment[];
};

export type PowerGraph = {
  readonly hub: Pt;
  readonly nodes: readonly GraphNode[];
  readonly segments: readonly GraphSegment[];
};

/** One rail as drawn: its cable's path in pixels and its charge. */
export type RailLine = {
  readonly id: string;
  readonly flow: Flow;
  /** CSS colour driving `currentColor`. */
  readonly color: string;
  readonly pulse: RailPulse;
  readonly d: string;
};

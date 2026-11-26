// The 2D flow's test plant: role values on the plant, an inverter and a loadpoint.
import { buildPowerGraph } from "./power-graph.ts";
import { flowReading, type FlowStrings } from "./reading.ts";
import type { GraphNode, Orientation, PowerGraph } from "./schematic.ts";

export const INVERTER = 1;
const LOADPOINT = 3;
export const PLANT = "4294967294";

export const STRINGS: FlowStrings = [
  { id: 1, name: "Süd", device: INVERTER },
  { id: 2, name: "Nord", device: INVERTER },
  { id: 3, name: "West", device: INVERTER },
];

export interface Plant {
  readonly plant?: Readonly<Record<string, number>>;
  /** The inverter's values, `pv.string.power[n]` and `inverter.power`. */
  readonly inverter?: Readonly<Record<string, number>>;
  readonly loadpoint?: Readonly<Record<string, number>>;
  readonly strings?: FlowStrings;
  readonly estimated?: Readonly<Record<string, readonly string[]>>;
}

/** Every plant role, all at rest. */
export const ALL = {
  "pv.power": 0,
  "battery.power": 0,
  "battery.soc": 50,
  "grid.power": 0,
  "load.power": 0,
  "generator.power": 0,
};

export function graph(p: Plant, orientation: Orientation = "landscape", fit = 6): PowerGraph {
  const loadpoint = p.loadpoint === undefined ? [] : [[String(LOADPOINT), p.loadpoint] as const];

  const values = Object.fromEntries([
    [PLANT, p.plant ?? {}],
    [String(INVERTER), p.inverter ?? {}],
    ...loadpoint,
  ]);

  return buildPowerGraph(flowReading(values, p.strings ?? [], p.estimated ?? {}), orientation, fit);
}

export function node(g: PowerGraph, id: string): GraphNode | undefined {
  return g.nodes.find((n) => n.id === id);
}

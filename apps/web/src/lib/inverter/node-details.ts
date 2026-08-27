import type { CanonicalRole, InverterCapabilities, ManifestMetric } from "$lib/inverter/types";
import * as m from "$lib/paraglide/messages";

/**
 * What each node of the power-flow diagram opens onto.
 *
 * The diagram already says what every subsystem is *doing*; this says what it is
 * *reading*. It is the same set of readouts /system used to lay out as a page of
 * panels — resolved per node instead, so the answer arrives where the question
 * is asked and the manifest stays the only source of it.
 *
 * Role-driven, never group-driven: a group name is author-chosen, so a profile
 * that calls its battery group `bat` would have rendered an empty panel. Roles
 * are the vocabulary every vendor's profile maps onto.
 *
 * Pure — the store resolves and renders, this decides. That is what makes it
 * testable at all: runes do not run under `bun test`.
 */

/** Readings shown as one indexed block — a PV string, a grid phase. */
export interface IndexedDetailGroup {
  label: string;
  metrics: ManifestMetric[];
}

/** The node's own quantity, charted at the head of its dialog. */
export interface PrimaryReading {
  metric: ManifestMetric;
  /** Series colour — the same energy token the node and its rail are drawn in. */
  accent: string;
  /** Signed: the chart splits red (consuming) / green (exporting) at zero. */
  diverging: boolean;
}

export interface NodeDetail {
  title: string;
  /**
   * The headline reading, with its history — what a /system KPI card carried.
   * Absent when the profile maps no such role. Never repeated among {@link rows}.
   */
  primary?: PrimaryReading;
  /** Plain rows, in the order the roles are listed below. */
  rows: ManifestMetric[];
  /** Per-string / per-phase blocks; empty when the profile maps none. */
  groups: IndexedDetailGroup[];
  /** The battery node leads with its state-of-charge bar. */
  batteryBar: boolean;
}

/** A node's non-indexed readings, and the indexed ones it groups by index. */
interface NodeSpec {
  title: (caps: InverterCapabilities | null) => string;
  rows: readonly CanonicalRole[];
  /** The role charted as the headline, and how to draw it. */
  primary?: { role: CanonicalRole; accent: string; diverging?: boolean };
  /** Indexed roles, plus how the block is labelled and how many to expect. */
  indexed?: {
    roles: readonly CanonicalRole[];
    label: string;
    count: (caps: InverterCapabilities | null) => number;
  };
  batteryBar?: boolean;
}

const phases = (caps: InverterCapabilities | null): number => caps?.phases ?? 1;

/**
 * Every node but the PV strings, whose ids carry an index and are built on
 * demand. The hub carries `pv.total.power`: total DC in is what the box in the
 * middle converts, and with per-string power mapped it is the one PV figure the
 * diagram never shows on a node of its own.
 */
const SPECS: Record<string, NodeSpec> = {
  hub: {
    title: () => m.label_inverter(),
    // Total DC in: what the box in the middle converts, and the one PV figure
    // no node shows once per-string power is mapped.
    primary: { role: "pv.total.power", accent: "var(--energy-solar)" },
    rows: [
      "inverter.status",
      "inverter.relay_status",
      "inverter.temperature.dc",
      "inverter.temperature.ac",
      "inverter.power",
      "inverter.efficiency",
      "pv.total.power",
    ],
  },
  solar: {
    title: () => m.label_solar(),
    primary: { role: "pv.total.power", accent: "var(--energy-solar)" },
    rows: ["pv.total.power", "production.today", "production.total"],
  },
  battery: {
    title: () => m.label_battery(),
    primary: { role: "battery.power", accent: "var(--energy-battery)", diverging: true },
    rows: [
      "battery.soc",
      "battery.power",
      "battery.voltage",
      "battery.current",
      "battery.temperature",
      "battery.mode",
      "battery.energy.charged.today",
      "battery.energy.charged.total",
      "battery.energy.discharged.today",
      "battery.energy.discharged.total",
    ],
    batteryBar: true,
  },
  grid: {
    // The phase count is the one thing about a grid connection a reader wants
    // before any number: it says which of the blocks below to expect.
    title: (caps) =>
      phases(caps) > 1 ? m.system_grid_phase({ count: phases(caps) }) : m.label_grid(),
    primary: { role: "grid.power", accent: "var(--energy-grid)", diverging: true },
    rows: [
      "grid.power",
      "grid.energy.imported.today",
      "grid.energy.imported.total",
      "grid.energy.exported.today",
      "grid.energy.exported.total",
    ],
    indexed: {
      roles: ["grid.phase.voltage", "grid.phase.current", "grid.phase.power"],
      label: m.label_phase(),
      count: phases,
    },
  },
  load: {
    title: () => m.label_load(),
    primary: { role: "load.power", accent: "var(--energy-load)" },
    // `backup.*` trails the house rows rather than forming a node of its own:
    // the two shapes of backup output land on the same box. A whole-home UPS
    // meters its islanded output once, as house load, so `load.*` already is
    // that reading; a vendor that meters it apart maps `backup.*`, and those
    // rows are dropped for every profile that does not.
    rows: [
      "load.power",
      "load.energy.today",
      "load.energy.total",
      "backup.power",
      "backup.energy.today",
      "backup.energy.total",
    ],
    indexed: {
      roles: ["load.phase.power", "load.phase.voltage"],
      label: m.label_phase(),
      count: phases,
    },
  },
  generator: {
    title: () => m.label_generator(),
    primary: { role: "generator.power", accent: "var(--energy-generator)" },
    rows: ["generator.power", "generator.energy.today"],
    indexed: {
      roles: ["generator.phase.power", "generator.phase.voltage"],
      label: m.label_phase(),
      count: phases,
    },
  },
};

/** The 1-based string index a `pv<n>` node id names, or null for anything else. */
function stringIndex(nodeId: string): number | null {
  const match = /^pv(\d+)$/.exec(nodeId);
  return match ? Number(match[1]) : null;
}

const PV_STRING_ROLES = ["pv.string.power", "pv.string.voltage", "pv.string.current"] as const;

/**
 * The spec for one PV-string node: that string's readings as plain rows. No
 * indexed block — the dialog is already titled "String 2", so captioning its
 * only block "String 2" again says nothing.
 */
function stringSpec(index: number): NodeSpec {
  return {
    title: () => `${m.label_string()} ${index}`,
    primary: { role: "pv.string.power", accent: "var(--energy-solar)" },
    rows: PV_STRING_ROLES,
  };
}

function byRole(
  metrics: ManifestMetric[],
  role: CanonicalRole,
  index?: number,
): ManifestMetric | undefined {
  return metrics.find((metric) => metric.role === role && metric.index === index);
}

/** The mapped metrics for these roles, in the order given. */
function pick(
  metrics: ManifestMetric[],
  roles: readonly CanonicalRole[],
  index?: number,
): ManifestMetric[] {
  return roles
    .map((role) => byRole(metrics, role, index))
    .filter((metric): metric is ManifestMetric => metric !== undefined);
}

/**
 * What the node with this id opens onto, or `null` when the profile maps none of
 * its readings — a box that opens onto an empty dialog is worse than one that
 * does not open, so the caller renders it as a plain box instead.
 *
 * `metrics` is the store's already-visibility-filtered catalog, so hiding a
 * group in Settings → Sensors takes its dialog with it.
 */
/** The headline reading this node's spec asks for, when the profile maps it. */
function headlineOf(
  spec: NodeSpec,
  metrics: ManifestMetric[],
  at: number | undefined,
): PrimaryReading | undefined {
  if (!spec.primary) return undefined;
  const metric = byRole(metrics, spec.primary.role, at);
  if (!metric) return undefined;
  return {
    metric,
    accent: spec.primary.accent,
    diverging: spec.primary.diverging === true,
  };
}

/**
 * The plain rows: the spec's roles, minus whatever is already on screen above
 * them. The bar reads the state of charge and the headline reads the power, so
 * neither is repeated as a row underneath itself.
 */
function rowsOf(
  spec: NodeSpec,
  metrics: ManifestMetric[],
  at: number | undefined,
  primary: PrimaryReading | undefined,
): ManifestMetric[] {
  const shown = new Set<string | undefined>([primary?.metric.key]);
  if (spec.batteryBar) shown.add(byRole(metrics, "battery.soc")?.key);
  return pick(metrics, spec.rows, at).filter((metric) => !shown.has(metric.key));
}

/** One block per index the capabilities promise, dropping the unmapped ones. */
function groupsOf(
  spec: NodeSpec,
  metrics: ManifestMetric[],
  caps: InverterCapabilities | null,
): IndexedDetailGroup[] {
  if (!spec.indexed) return [];
  const { roles, label, count } = spec.indexed;
  const groups: IndexedDetailGroup[] = [];
  for (let i = 1; i <= count(caps); i++) {
    const found = pick(metrics, roles, i);
    // An unmapped phase renders nothing rather than an empty captioned block.
    if (found.length > 0) groups.push({ label: `${label} ${i}`, metrics: found });
  }
  return groups;
}

export function nodeDetail(
  nodeId: string,
  metrics: ManifestMetric[],
  caps: InverterCapabilities | null,
): NodeDetail | null {
  const index = stringIndex(nodeId);
  const spec = index === null ? SPECS[nodeId] : stringSpec(index);
  if (!spec) return null;

  // A string node's rows are that string's own index; every other node's rows
  // are the unindexed readings.
  const at = index ?? undefined;
  const primary = headlineOf(spec, metrics, at);
  const rows = rowsOf(spec, metrics, at, primary);
  const groups = groupsOf(spec, metrics, caps);
  const batteryBar = spec.batteryBar === true && byRole(metrics, "battery.soc") !== undefined;
  // The bar and the headline are content in their own right, so a profile that
  // maps only a state of charge still has a dialog worth opening.
  if (rows.length === 0 && groups.length === 0 && !batteryBar && !primary) return null;
  return { title: spec.title(caps), ...(primary ? { primary } : {}), rows, groups, batteryBar };
}

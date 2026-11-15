/** The energy flows (ADR 21); each has one fixed colour everywhere. */
export const FLOWS = ["solar", "battery", "import", "export", "house", "ev"] as const;

export type Flow = (typeof FLOWS)[number];

export function flowColour(flow: Flow): string {
  return `var(--e-${flow})`;
}

/** Corrections and comparisons against a model or a previous period, outside the flows. */
export const DIVERGING = { under: "var(--d-under)", over: "var(--d-over)" } as const;

/** By role prefix (ADR 4), most specific first; mapped as the prototype colours its figures. */
const ROLE_FLOWS: readonly (readonly [string, Flow])[] = [
  ["grid.energy.imported", "import"],
  ["price.import", "import"],
  ["cost.import", "import"],
  ["grid.energy.exported", "export"],
  ["price.export", "export"],
  ["cost.export", "export"],
  ["grid", "export"],
  ["pv", "solar"],
  ["inverter", "solar"],
  ["weather", "solar"],
  ["cost.savings", "solar"],
  ["battery", "battery"],
  ["ev", "ev"],
];

/** The flow a role's series is drawn in; a role of no flow is drawn neutral, as the house. */
export function roleFlow(role: string): Flow {
  const match = ROLE_FLOWS.find(
    ([prefix]) => /^[.[]?$/u.test(role.charAt(prefix.length)) && role.startsWith(prefix),
  );

  return match?.[1] ?? "house";
}

/** MPPT inputs stacked in one bar: the solar colour first, then neighbours on the warm side. */
const MPPT = [
  "var(--e-solar)",
  "oklch(0.62 0.17 35)",
  "oklch(0.8 0.13 100)",
  "oklch(0.55 0.13 15)",
] as const;

/** The colour MPPT input `input` (from 1) is stacked in. */
export function mpptColour(input: number): string {
  return MPPT[(Math.max(1, input) - 1) % MPPT.length]!;
}

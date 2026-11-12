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

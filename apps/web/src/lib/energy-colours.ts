/** The energy flows (ADR 21); each has one fixed colour everywhere. */
export const FLOWS = ["solar", "battery", "import", "export", "house", "ev"] as const;

export type Flow = (typeof FLOWS)[number];

export function flowColour(flow: Flow): string {
  return `var(--e-${flow})`;
}

/** Corrections and comparisons against a model or a previous period, outside the flows. */
export const DIVERGING = { under: "var(--d-under)", over: "var(--d-over)" } as const;

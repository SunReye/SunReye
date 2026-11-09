// Model names map to a body class and a colour (ADR 20). Names are data only: SunReye draws its
// own bodies. An entry's id is what EVCC's loadpoint profile (profiles/evcc.ts) reads a matching
// vehicle title as, stored in history: never reuse or renumber one.
import type { BodyClass } from "../builder/pv.ts";

export interface CatalogueEntry {
  readonly id: number;
  readonly model: string;
  readonly class: BodyClass;
  /** `#rrggbb`. */
  readonly colour: string;
}

export const catalogue: readonly CatalogueEntry[] = [
  { id: 1, model: "Tesla Model 3 Highland", class: "sedan", colour: "#f2f2ee" },
  { id: 2, model: "Tesla Model Y", class: "suv", colour: "#f2f2ee" },
  { id: 3, model: "Volkswagen ID.3", class: "hatchback", colour: "#8c9aa6" },
  { id: 4, model: "Volkswagen ID. Buzz", class: "van", colour: "#e8b600" },
  { id: 5, model: "Ford F-150 Lightning", class: "pickup", colour: "#1f3a5f" },
];

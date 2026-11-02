import type { components } from "$lib/core-api.gen";

// Row shapes shared by the profiles settings form and its sub-components.

export type RegisteredProfile = {
  id: string;
  name: string;
  manufacturer: string;
  active: boolean;
  installed: boolean;
  /** Shipped in-repo (registered but not downloaded); shown as "Built in". */
  builtin: boolean;
  version?: string;
};

export type Source = components["schemas"]["Source"];
/** A source as the core lists it, with the ids of the profiles it supplied. */
export type StoredSource = components["schemas"]["Listed"];
export type Skipped = components["schemas"]["Skipped"];

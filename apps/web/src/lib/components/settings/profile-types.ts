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

// `official` marks the protected default source (disable-but-not-remove). The
// server tags it on read, so the web doesn't re-derive the URL check.
export type Source = { url: string; label?: string; enabled: boolean; official?: boolean };

/** An installed profile with a newer release waiting in its source repo. */
export type ProfileUpdate = {
  id: string;
  name: string;
  manufacturer: string;
  source: string;
  installedVersion: string;
  latestVersion: string;
};

export type AvailableProfile = {
  id: string;
  name: string;
  manufacturer: string;
  version: string;
  path: string;
  description?: string;
  source: string;
  installed: boolean;
  installedVersion?: string;
  updateAvailable: boolean;
};

/** One inverter family (shared register base + its SKU models) within a manufacturer. */
export type FamilyGroup = { key: string; label: string; profiles: AvailableProfile[] };

/** Available profiles bucketed by manufacturer, then by family, for the browser UI. */
export type ManufacturerGroup = {
  manufacturer: string;
  families: FamilyGroup[];
  count: number;
};

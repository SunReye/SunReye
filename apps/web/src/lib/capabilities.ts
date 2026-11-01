import type { components } from "./core-api.gen";

/** The SPA areas the core serves, as `GET /api/capabilities` reports them. */
export type Capabilities = components["schemas"]["Capabilities"];
export type CapabilityName = keyof Capabilities;

/**
 * Whether the connected engine serves `name`.
 *
 * Only an engine that answered, and said `false`, hides an area: no answer yet, or an
 * engine without the endpoint (the 3.x one), serves everything the SPA shows.
 */
export function hasCapability(capabilities: Capabilities | null, name: CapabilityName): boolean {
  return capabilities === null || capabilities[name];
}

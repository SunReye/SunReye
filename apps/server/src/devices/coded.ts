/**
 * THE CODED TIER'S TABLE: which `devices.profile_id` values are declarations
 * compiled into this server rather than register maps installed from a git
 * source.
 *
 * A device goes in the LOWEST tier that can express it — a user's mapping first,
 * a profile when it needs a register map, and code only when it needs logic no
 * DSL can carry. EVCC qualifies on the last count: an MQTT topic grammar, a
 * feed-forward power estimator and a three-layer charge-limit resolution are not
 * expressible as a register map, and never will be.
 *
 * The table is the ONE place that knows a coded id from a profile id, and it is
 * a LOOKUP rather than a branch. Nothing downstream can tell the tiers apart:
 * what comes out of the registry is a `DeviceInstance` either way, and a
 * consumer that branched on `integration === "evcc"` would be the acceptance
 * failure this deliverable is written against.
 */

import { EVCC_INTEGRATION, EVCC_LOADPOINT_PROFILE, LOADPOINT_METRICS } from "../evcc/evcc-devices";
import type { CodedDeclaration } from "./registry";

/**
 * Every coded declaration, keyed by the `profile_id` its device rows name.
 *
 * A `Map` rather than an object literal because the key arrives from a database
 * column: a row saying `profile_id = 'constructor'` must resolve to nothing, and
 * against an object it would resolve to a function.
 */
const CODED_INTEGRATIONS = new Map<string, CodedDeclaration>([
  [EVCC_LOADPOINT_PROFILE, { integration: EVCC_INTEGRATION, metrics: LOADPOINT_METRICS }],
]);

/** The coded declaration a `profile_id` names, or null when it names a profile. */
export function resolveCoded(profileId: string): CodedDeclaration | null {
  return CODED_INTEGRATIONS.get(profileId) ?? null;
}

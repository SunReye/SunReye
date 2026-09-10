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

import {
  OPTIMIZER_INTEGRATION,
  OPTIMIZER_METRICS,
  OPTIMIZER_PROFILE,
} from "../automation/optimizer-device";
import { EVCC_INTEGRATION, EVCC_LOADPOINT_PROFILE, LOADPOINT_METRICS } from "../evcc/evcc-devices";
import type { CodedDeclaration } from "./registry";

/**
 * A declaration plus the one fact a CATALOG needs that the runtime does not:
 * whether the thing has an endpoint at all.
 *
 * On the declaration's row rather than in a list beside it, for the same reason
 * the table itself exists — see {@link codedIntegrations}. A `connectionless`
 * declaration is one nobody configures a URL, a host or a broker for: the
 * optimizer is a control loop with no machine behind it, and #197's weather
 * device dials a vendor URL that is not an endpoint anyone picks. An EVCC
 * loadpoint is NOT one: it is pushed over a specific broker, and its device row
 * carries that connection's id.
 */
type CodedRow = CodedDeclaration & { connectionless?: true };

/**
 * Every coded declaration, keyed by the `profile_id` its device rows name.
 *
 * A `Map` rather than an object literal because the key arrives from a database
 * column: a row saying `profile_id = 'constructor'` must resolve to nothing, and
 * against an object it would resolve to a function.
 */
const CODED_INTEGRATIONS = new Map<string, CodedRow>([
  [
    EVCC_LOADPOINT_PROFILE,
    { integration: EVCC_INTEGRATION, name: "EVCC loadpoint", metrics: LOADPOINT_METRICS },
  ],
  // The optimizer qualifies for the coded tier on the same count EVCC does, and
  // then some: what it declares are the outputs of a control loop — a forecast
  // model, a price-window search and a register-bounds resolution — and there is
  // no register map to express any of it. It has no machine behind it at all.
  [
    OPTIMIZER_PROFILE,
    {
      integration: OPTIMIZER_INTEGRATION,
      name: "SunReye Optimizer",
      metrics: OPTIMIZER_METRICS,
      connectionless: true,
    },
  ],
]);

/** The coded declaration a `profile_id` names, or null when it names a profile. */
export function resolveCoded(profileId: string): CodedDeclaration | null {
  return CODED_INTEGRATIONS.get(profileId) ?? null;
}

/**
 * One coded integration as a CATALOG reads it: what it is called, and nothing
 * about what it can do.
 *
 * Deliberately not `CodedDeclaration` itself. A declaration carries `metrics`,
 * which is the register-level truth the runtime needs and the wizard has no
 * business rendering; a projection is what keeps a catalog from growing a
 * dependency on it.
 */
export interface CodedCatalogEntry {
  /** The `devices.profile_id` value that resolves to this declaration. */
  profileId: string;
  /** Provenance. Grouping only — nothing branches on it. */
  integration: string;
  /** What to call it on screen. */
  name: string;
  /**
   * Whether it runs over NO connection — what puts it in the catalog's
   * "internal" group.
   *
   * The null arm used to project EVERY coded declaration, which listed the EVCC
   * loadpoint as connection-less. It is not: a loadpoint is pushed over a
   * particular broker, and its device row is bound to that connection. Offering
   * it under "internal" invited an operator to add one with no broker, which
   * nothing would ever subscribe for.
   */
  connectionless: boolean;
}

/**
 * Every coded declaration, projected for a catalog, in table order.
 *
 * THE POINT OF THIS EXPORT is that `./integration-catalog.ts`'s "internal"
 * group is DERIVED rather than hand-maintained. Two lists of coded ids would
 * drift on the first PR that adds one — #197's weather device is already queued
 * — and the drift is silent: the device works and the wizard simply never
 * mentions it. Adding a row to {@link CODED_INTEGRATIONS} is the whole change.
 *
 * A fresh array each call: the map is module state, and a shared array would let
 * a caller mutate the catalog for every other caller in the process.
 */
export function codedIntegrations(): readonly CodedCatalogEntry[] {
  return [...CODED_INTEGRATIONS].map(([profileId, declaration]) => ({
    profileId,
    integration: declaration.integration,
    name: declaration.name ?? declaration.integration,
    connectionless: declaration.connectionless === true,
  }));
}

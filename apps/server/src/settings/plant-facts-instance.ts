/**
 * The process's single {@link PlantFacts} accessor, bound to the real database.
 *
 * Separate from `./plant-facts.ts` (the factory) for the reason `./config.ts` and
 * the runtime split the same way: the factory takes its collaborators and is
 * driven by a test against an in-memory spine, while THIS module is the wiring —
 * it imports the client, so importing it pulls in `@SunReye/env`.
 */

import { db } from "@SunReye/db";

import { dbProvisionStore } from "../inverter/provision";
import { log } from "../shared/logging";
import { createPlantFacts } from "./plant-facts";

/**
 * The one cached view of the plant row and its packs.
 *
 * One instance, because the cache is the point: the weather config, the plant
 * time zone and the spot-price zone are all compositions over this row, and a
 * second instance would mean a write through one leaving the other stale.
 */
export const plantFacts = createPlantFacts({
  // `db` is read PER CALL, not captured at module evaluation.
  //
  // `mock.module` patches a module's exports in place, so a suite that stubs
  // `@SunReye/db` reaches every consumer that reads `db` when it runs — and
  // misses every consumer that read it at import time. This module is loaded
  // eagerly by the settings barrel, i.e. before any suite installs its stub, so
  // `dbProvisionStore(db)` here would have bound the REAL client for good and
  // the cost suites would open a socket to the developer's database (which is
  // shared with a live inverter). The indirection is one arrow function and it
  // removes that whole class of accident.
  store: dbProvisionStore({ execute: (query) => db.execute(query) }),
  logger: log("plant"),
});

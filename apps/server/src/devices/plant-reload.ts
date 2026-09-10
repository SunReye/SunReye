/**
 * WHAT EVERY PLANT WRITE IS FOLLOWED BY, in the one order that works.
 *
 * A device, a connection or an integration write all change the same two things
 * — which endpoints exist, and what is reached through them — so they all run
 * this. Spelled once because the ORDER is the content, and two copies of an
 * order drift into one:
 *
 *  1. THE CONNECTIONS. A pass of the tier re-opens an edited broker, releases a
 *     deleted one and opens a row nothing was bound to before (#221).
 *  2. THE POLL LOOP. `reloadEndpoint` re-reads the roster and the Modbus
 *     address, and rebuilds the Home Assistant export — which takes its client
 *     FROM a connection, so that client has to exist first.
 *
 * Reversed, an integration added on a brand-new broker would rebuild the export
 * against a connection with no client and come up silent until the next write.
 */

import { reloadEndpoint } from "../inverter/runtime";
import { reloadConnections } from "./connection-runtime";

export async function reopenPlantRuntime(): Promise<void> {
  await reloadConnections();
  await reloadEndpoint();
}

import { type PlantDb, ensureDevice, isRetired, readPlant } from "@SunReye/db/plant-repo";

import { optimizerDeviceSpec } from "../automation/optimizer-device";
import type { DeviceRowState } from "../automation/optimizer-registrar";

/**
 * The optimizer's `devices` row, over the plant spine `client` reaches.
 *
 * RETIRED IS NOT REGISTERED. `ensureDevice` is `ON CONFLICT DO NOTHING` +
 * SELECT, so it answers "the row is there" for a row the operator retired in
 * Settings → Devices — while the roster read excludes exactly that row. The
 * registrar has to be told the difference or it waits for an instance that is
 * never coming.
 *
 * `"absent"` is a legal answer: the automation loop can be armed on a boot that
 * has no plant yet, and taking it down over a missing device row would be worse
 * than storing nothing until the next tick.
 *
 * The client is a parameter rather than the app's `db`, so its suite needs no
 * `mock.module` — see `./optimizer-row.test.ts` for what one cost.
 */
export async function ensureOptimizerRow(client: PlantDb): Promise<DeviceRowState> {
  const plant = await readPlant(client);
  if (!plant) return "absent";
  return isRetired(await ensureDevice(client, optimizerDeviceSpec(plant.id))) ? "retired" : "ready";
}

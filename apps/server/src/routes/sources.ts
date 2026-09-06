import { Elysia } from "elysia";
import { db } from "@SunReye/db";
import { readDevices, readPlant, readPlantBatteries } from "@SunReye/db/plant-repo";
import { type PlantSourcesStore, listSources, readPlantMembers } from "../devices/plant-sources";
import { adminGuard } from "./admin-guard";

/** Production wiring, built PER CALL so `mock.module` on `@SunReye/db` reaches it. */
function sourcesStore(): PlantSourcesStore {
  const client = { execute: (query: Parameters<typeof db.execute>[0]) => db.execute(query) };
  return {
    readPlant: () => readPlant(client),
    // History keeps retired devices; `plantMembers` decides per read.
    readDevices: (plantId) => readDevices(client, plantId, { includeRetired: true }),
    readPlantBatteries: (plantId) => readPlantBatteries(client, plantId),
  };
}

/** The plant's history members, retired included — see `../shared/plant-source.ts`. */
export const historyMembers = () => readPlantMembers(sourcesStore());
/** The plant's live members — active devices only. */
export const liveMembers = () => readPlantMembers(sourcesStore(), { live: true });

/**
 * `GET /api/sources` — what a dashboard may read a series from: the plant, and
 * each physical device. Session-gated like every other dashboard read; the
 * admin roster with connections and unit ids stays on `/api/devices`.
 */
export const sourcesRoutes = new Elysia()
  .use(adminGuard)
  .get("/api/sources", { requireSession: true }, () => listSources(sourcesStore()));

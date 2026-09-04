import { db } from "@SunReye/db";
import {
  createConnection,
  createDevice,
  deleteConnection,
  deleteDeviceBattery,
  readConnections,
  readDevices,
  readPlant,
  readPlantBatteries,
  updateConnection,
  updateDevice,
  upsertDeviceBattery,
} from "@SunReye/db/plant-repo";
import { Elysia, t } from "elysia";

import {
  type DeviceAdminDeps,
  DeviceAdminError,
  addDevice,
  listDevices,
  patchConnection,
  patchDevice,
  removeConnection,
} from "../devices/device-admin";
import { deviceRegistry } from "../devices/registry-instance";
import { resolveProfileById } from "../inverter/inverter";
import * as runtime from "../inverter/runtime";
import { adminGuard } from "./admin-guard";

/**
 * The device roster — `Settings → Devices`.
 *
 * Admin on every method, reads included: the roster is the plant's hardware
 * inventory (which gateways, which slave ids, which firmware profile), the same
 * reasoning that made `/api/profiles/updates` admin-only.
 *
 * Bodies are `t.Unknown()` and parsed by the service's Zod schemas, like every
 * other settings write: Elysia validates a declared body BEFORE the guard runs,
 * so a typed body would let the route-smoke's gate probe stop at 422 and prove
 * nothing about who may call it (`scripts/route-smoke-plan.ts`).
 */

/** Production wiring, built PER CALL so `mock.module` on `@SunReye/db` reaches it. */
function defaultDeps(): DeviceAdminDeps {
  const client = { execute: (query: Parameters<typeof db.execute>[0]) => db.execute(query) };
  return {
    store: {
      readPlant: () => readPlant(client),
      readConnections: (plantId) => readConnections(client, plantId),
      readDevices: (plantId, options) => readDevices(client, plantId, options),
      createConnection: (plantId, settings) => createConnection(client, plantId, settings),
      createDevice: (spec) => createDevice(client, spec),
      updateDevice: (id, patch) => updateDevice(client, id, patch),
      updateConnection: (id, patch) => updateConnection(client, id, patch),
      deleteConnection: (id) => deleteConnection(client, id),
      readPlantBatteries: (plantId) => readPlantBatteries(client, plantId),
      upsertDeviceBattery: (deviceId, battery) => upsertDeviceBattery(client, deviceId, battery),
      deleteDeviceBattery: (deviceId) => deleteDeviceBattery(client, deviceId),
    },
    profileName: async (id) => (await resolveProfileById(id))?.name ?? null,
    primarySlug: () => deviceRegistry.primary()?.id ?? null,
    reload: () => runtime.reloadEndpoint(),
  };
}

/** A service refusal as its status; anything else is the 500 it deserves. */
function refusal(error: unknown) {
  if (error instanceof DeviceAdminError) {
    return { status: error.status, body: { error: error.message, field: error.field ?? null } };
  }
  throw error;
}

/** A by-id param, or the 400 it deserves. */
function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const BAD_ID = { error: "id must be a positive integer", field: null } as const;

/** Run one service call for the route, mapping refusals to their status. */
async function respond<T>(
  status: (code: 400 | 404 | 409, body: unknown) => unknown,
  run: () => Promise<T>,
) {
  try {
    return await run();
  } catch (error) {
    const refused = refusal(error);
    return status(refused.status, refused.body);
  }
}

// `id` params are `t.String()`, not `t.Numeric()`: a typed param is validated
// BEFORE the guard, and the smoke's placeholder would 422 there — see above.
const byId = { requireAdmin: true, params: t.Object({ id: t.String() }) } as const;
const byIdWrite = { ...byId, body: t.Unknown() } as const;

export const deviceRoutes = new Elysia({ name: "device-routes" })
  .use(adminGuard)
  .get("/api/devices", { requireAdmin: true }, () => listDevices(defaultDeps()))
  .get("/api/connections", { requireAdmin: true }, async () => {
    const deps = defaultDeps();
    const plant = await deps.store.readPlant();
    return { connections: plant ? await deps.store.readConnections(plant.id) : [] };
  })
  .post("/api/devices", { requireAdmin: true, body: t.Unknown() }, ({ body, status }) =>
    respond(status, () => addDevice(defaultDeps(), body)),
  )
  .patch("/api/devices/:id", byIdWrite, ({ params, body, status }) => {
    const id = parseId(params.id);
    if (id === null) return status(400, BAD_ID);
    return respond(status, () => patchDevice(defaultDeps(), id, body));
  })
  .patch("/api/connections/:id", byIdWrite, ({ params, body, status }) => {
    const id = parseId(params.id);
    if (id === null) return status(400, BAD_ID);
    return respond(status, () => patchConnection(defaultDeps(), id, body));
  })
  .delete("/api/connections/:id", byId, ({ params, status }) => {
    const id = parseId(params.id);
    if (id === null) return status(400, BAD_ID);
    return respond(status, async () => {
      await removeConnection(defaultDeps(), id);
      return { ok: true, id };
    });
  });

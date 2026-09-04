import { db } from "@SunReye/db";
import {
  createConnection,
  createDevice,
  readConnections,
  readDevices,
  readPlant,
  updateDevice,
} from "@SunReye/db/plant-repo";
import { Elysia, t } from "elysia";

import {
  type DeviceAdminDeps,
  DeviceAdminError,
  addDevice,
  listDevices,
  patchDevice,
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

export const deviceRoutes = new Elysia({ name: "device-routes" })
  .use(adminGuard)
  .get("/api/devices", { requireAdmin: true }, () => listDevices(defaultDeps()))
  .get("/api/connections", { requireAdmin: true }, async () => {
    const deps = defaultDeps();
    const plant = await deps.store.readPlant();
    return { connections: plant ? await deps.store.readConnections(plant.id) : [] };
  })
  .post("/api/devices", { requireAdmin: true, body: t.Unknown() }, async ({ body, status }) => {
    try {
      return await addDevice(defaultDeps(), body);
    } catch (error) {
      const refused = refusal(error);
      return status(refused.status, refused.body);
    }
  })
  .patch(
    "/api/devices/:id",
    // `t.String()`, not `t.Numeric()`: a typed param is validated BEFORE the
    // guard, and the smoke's placeholder would 422 there — see the note above.
    { requireAdmin: true, params: t.Object({ id: t.String() }), body: t.Unknown() },
    async ({ params, body, status }) => {
      const id = Number(params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return status(400, { error: "device id must be a positive integer", field: null });
      }
      try {
        return await patchDevice(defaultDeps(), id, body);
      } catch (error) {
        const refused = refusal(error);
        return status(refused.status, refused.body);
      }
    },
  );

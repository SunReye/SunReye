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
  addConnection,
  addDevice,
  listConnections,
  listDevices,
  patchConnection,
  patchDevice,
  removeConnection,
} from "../devices/device-admin";
import { afterDeviceWrite } from "../devices/after-device-write";
import { reopenPlantRuntime } from "../devices/plant-reload";
import { resolveCoded } from "../devices/coded";
import { plantFacts } from "../settings/plant-facts-instance";
import { probeConnection } from "../devices/reachability";
import { deviceRegistry } from "../devices/registry-instance";
import { resolveProfileById } from "../inverter/inverter";
import { plantClient } from "../shared/plant-client";
import { adminResponder, byId, byIdWrite } from "./admin-refusal";
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
  const client = plantClient();
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
    // The coded tier has no profile row to resolve, so the roster asks the
    // declaration table before reporting a device's profile as missing (#213).
    coded: (id) => resolveCoded(id),
    primarySlug: () => deviceRegistry.primary()?.id ?? null,
    reload: () => afterDeviceWrite(plantFacts, reopenPlantRuntime),
  };
}

const { respond, withId } = adminResponder((error) => error instanceof DeviceAdminError);

export const deviceRoutes = new Elysia({ name: "device-routes" })
  .use(adminGuard)
  .get("/api/devices", { requireAdmin: true }, () => listDevices(defaultDeps()))
  // MASKED: a `kind = 'mqtt'` row carries a broker password, and the masking
  // follows the secret (#217). `listConnections` is the service call rather than
  // a store read spelled here, so this route cannot forget it.
  .get("/api/connections", { requireAdmin: true }, () => listConnections(defaultDeps()))
  // A connection ON ITS OWN (#217). The `connection: { create }` arm of
  // `POST /api/devices` can only make one alongside a device, and a broker never
  // has one at creation time — its loadpoints appear after the ingest is bound
  // to it and its first message lands.
  .post("/api/connections", { requireAdmin: true, body: t.Unknown() }, ({ body, status }) =>
    respond(status, () => addConnection(defaultDeps(), body)),
  )
  .post("/api/devices", { requireAdmin: true, body: t.Unknown() }, ({ body, status }) =>
    respond(status, () => addDevice(defaultDeps(), body)),
  )
  // Is the endpoint there? PER KIND (#217): a Modbus gateway answers a TCP
  // connect to host:port, a broker answers an MQTT CONNECT. No unit id, no
  // profile, no register read — the device dialog's test is the one that reads
  // registers. A bare `{ host, port }` body is still a Modbus probe, so the
  // current add-connection dialog keeps working until the web half lands.
  .post(
    "/api/connections/probe",
    { requireAdmin: true, body: t.Unknown() },
    async ({ body, status }) => {
      try {
        return await probeConnection(body);
      } catch (error) {
        return status(400, {
          error: error instanceof Error ? error.message : "invalid probe",
          field: null,
        });
      }
    },
  )
  .patch("/api/devices/:id", byIdWrite, ({ params, body, status }) =>
    withId(status, params.id, (id) => patchDevice(defaultDeps(), id, body)),
  )
  .patch("/api/connections/:id", byIdWrite, ({ params, body, status }) =>
    withId(status, params.id, (id) => patchConnection(defaultDeps(), id, body)),
  )
  .delete("/api/connections/:id", byId, ({ params, status }) =>
    withId(status, params.id, async (id) => {
      await removeConnection(defaultDeps(), id);
      return { ok: true, id };
    }),
  );

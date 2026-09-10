import {
  createIntegration,
  deleteIntegration as deleteIntegrationRow,
  readIntegrations,
  updateIntegration,
} from "@SunReye/db/integrations-store";
import { readConnections, readDevices, readPlant, updateDevice } from "@SunReye/db/plant-repo";
import { Elysia, t } from "elysia";

import { afterDeviceWrite } from "../devices/after-device-write";
import { reopenPlantRuntime } from "../devices/plant-reload";
import { connectionStatus } from "../devices/connection-runtime";
import { catalogFor, catalogViewFor } from "../devices/integration-catalog";
import {
  type IntegrationAdminDeps,
  IntegrationAdminError,
  addIntegration,
  deleteIntegration,
  listIntegrations,
  patchIntegration,
} from "../integrations/integration-admin";
import { plantClient } from "../shared/plant-client";
import { plantFacts } from "../settings/plant-facts-instance";
import { adminResponder, byId, byIdWrite } from "./admin-refusal";
import { adminGuard } from "./admin-guard";

/**
 * The integration list — `Settings → Devices`, the half that is not hardware.
 *
 * Admin on every method, reads included, for the same reason `./devices.ts` is:
 * an integration row names which broker something publishes on and under which
 * topic tree, which is the plant's wiring rather than its readings.
 *
 * Bodies are `t.Unknown()` and parsed by the service's Zod schemas, like every
 * other settings write: Elysia validates a declared body BEFORE the guard runs,
 * so a typed body would let the route-smoke's gate probe stop at 422 and prove
 * nothing about who may call it (`scripts/route-smoke-plan.ts`).
 */

/** Production wiring, built PER CALL so `mock.module` on `@SunReye/db` reaches it. */
function defaultDeps(): IntegrationAdminDeps {
  const client = plantClient();
  return {
    store: {
      readPlant: () => readPlant(client),
      readConnections: (plantId) => readConnections(client, plantId),
      readIntegrations: (plantId) => readIntegrations(client, plantId),
      createIntegration: (plantId, spec) => createIntegration(client, plantId, spec),
      updateIntegration: (id, patch) => updateIntegration(client, id, patch),
      deleteIntegration: (id) => deleteIntegrationRow(client, id),
      // Retired rows INCLUDED: a delete must not re-stamp a loadpoint the
      // operator already retired, and `retired_at` is a boundary the history
      // reads are drawn against.
      readDevices: (plantId) => readDevices(client, plantId),
      updateDevice: (id, patch) => updateDevice(client, id, patch),
    },
    catalog: catalogFor,
    // OBSERVED, not derived (#221): the process's broker pool is asked whether
    // the row's client is up right now.
    connectionStatus,
    reload: () => afterDeviceWrite(plantFacts, reopenPlantRuntime),
  };
}

const { respond, withId } = adminResponder((error) => error instanceof IntegrationAdminError);

export const integrationRoutes = new Elysia({ name: "integration-routes" })
  .use(adminGuard)
  .get("/api/integrations", { requireAdmin: true }, () => listIntegrations(defaultDeps()))
  // WHAT MAY BE ADDED, keyed by connection kind — the wizard renders this and
  // knows no kind by name. `internal` is the catalog's null arm: the coded
  // things that run over no connection at all (the optimizer today, #197's
  // weather device next), which is why it is a third key rather than an absence.
  .get("/api/integrations/catalog", { requireAdmin: true }, () => ({
    modbus: catalogViewFor("modbus"),
    mqtt: catalogViewFor("mqtt"),
    internal: catalogViewFor(null),
  }))
  .post("/api/integrations", { requireAdmin: true, body: t.Unknown() }, ({ body, status }) =>
    respond(status, () => addIntegration(defaultDeps(), body)),
  )
  .patch("/api/integrations/:id", byIdWrite, ({ params, body, status }) =>
    withId(status, params.id, (id) => patchIntegration(defaultDeps(), id, body)),
  )
  .delete("/api/integrations/:id", byId, ({ params, status }) =>
    withId(status, params.id, async (id) => {
      await deleteIntegration(defaultDeps(), id);
      return { ok: true, id };
    }),
  );

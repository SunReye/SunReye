/**
 * The roster's production adapter: devices, connections and profiles on the
 * core's typed client; integrations on Eden, asked only of an engine that serves
 * them. The one place an answer's `data` is cast to the contract type the
 * server built it from.
 */

import { api } from "$lib/api";
import type { CapabilityName } from "$lib/capabilities";
import { core } from "$lib/core-api";
import type { Catalog } from "../wizard/add-wizard";
import type { Answer, RosterTransport } from "./device-roster";

/** The two fields of an Eden answer this reads. */
type EdenAnswer = { data: unknown; error: { value: unknown } | null };

async function answer<T>(request: Promise<EdenAnswer>): Promise<Answer<T>> {
  const { data, error } = await request;
  return data ? { ok: true, data: data as T } : { ok: false, error: error?.value };
}

/** A core answer. A dead connection throws; it is a failure with no reason, like the rest. */
async function coreAnswer<T>(
  request: Promise<{ data?: unknown; error?: unknown }>,
): Promise<Answer<T>> {
  try {
    const { data, error } = await request;
    return data ? { ok: true, data: data as T } : { ok: false, error };
  } catch {
    return { ok: false, error: undefined };
  }
}

/** What a core without integrations attaches: a Modbus device by profile, nothing else. */
const DEVICES_ONLY: Catalog = {
  modbus: [
    {
      id: "modbus-device",
      label: "Modbus device",
      via: "profile",
      addable: true,
      multiInstance: true,
      fields: [],
    },
  ],
  mqtt: [],
  internal: [],
};

const byId = (id: number) => ({ params: { path: { id } } });
const integration = (id: number) => api.api.integrations({ id: String(id) });

/** `offers` is the connected engine's capabilities: absent integrations are answered here, unasked. */
export function rosterTransport(offers: (area: CapabilityName) => boolean): RosterTransport {
  return {
    devices: () => coreAnswer(core.GET("/api/devices")),
    integrations: async () =>
      offers("integrations")
        ? answer(api.api.integrations.get())
        : { ok: true, data: { integrations: [] } },
    catalog: async () =>
      offers("integrations")
        ? answer(api.api.integrations.catalog.get())
        : { ok: true, data: DEVICES_ONLY },
    profiles: () => coreAnswer(core.GET("/api/profiles")),
    addDevice: (body) => coreAnswer(core.POST("/api/devices", { body: body as never })),
    patchDevice: (id, body) => coreAnswer(core.PATCH("/api/devices/{id}", { ...byId(id), body })),
    deleteDevice: (id) => coreAnswer(core.DELETE("/api/devices/{id}", byId(id))),
    addConnection: (body) => coreAnswer(core.POST("/api/connections", { body: body as never })),
    patchConnection: (id, body) =>
      coreAnswer(core.PATCH("/api/connections/{id}", { ...byId(id), body: body as never })),
    deleteConnection: (id) => coreAnswer(core.DELETE("/api/connections/{id}", byId(id))),
    addIntegration: (body) => answer(api.api.integrations.post(body)),
    patchIntegration: (id, body) => answer(integration(id).patch(body)),
    deleteIntegration: (id) => answer(integration(id).delete()),
  };
}

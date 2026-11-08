/**
 * The roster's production adapter: every read and write on the core's client.
 * Integrations are asked only of a core that reports them served. The one place
 * an answer's `data` is cast to the contract type the server built it from.
 */

import type { CapabilityName } from "$lib/capabilities";
import { core } from "$lib/core-api";
import { byPath } from "$lib/core-by-path";
import * as m from "$lib/paraglide/messages";
import type { Catalog } from "../wizard/add-wizard";
import type { Answer, RosterTransport } from "./device-roster";

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
const devicesOnly = (): Catalog => ({
  modbus: [
    {
      id: "modbus-device",
      label: m.wizard_attach_modbus_device(),
      via: "profile",
      addable: true,
      multiInstance: true,
      fields: [],
    },
  ],
  mqtt: [],
  internal: [],
});

const byId = (id: number) => ({ params: { path: { id } } });

const withId = (id: number) => `/api/integrations/${id}`;

/** `offers` is the connected engine's capabilities: absent integrations are answered here, unasked. */
export function rosterTransport(offers: (area: CapabilityName) => boolean): RosterTransport {
  return {
    devices: () => coreAnswer(core.GET("/api/devices")),
    integrations: async () =>
      offers("integrations")
        ? coreAnswer(byPath.GET("/api/integrations"))
        : { ok: true, data: { integrations: [] } },
    catalog: async () =>
      offers("integrations")
        ? coreAnswer(byPath.GET("/api/integrations/catalog"))
        : { ok: true, data: devicesOnly() },
    profiles: () => coreAnswer(core.GET("/api/profiles")),
    addDevice: (body) => coreAnswer(core.POST("/api/devices", { body: body as never })),
    patchDevice: (id, body) => coreAnswer(core.PATCH("/api/devices/{id}", { ...byId(id), body })),
    deleteDevice: (id) => coreAnswer(core.DELETE("/api/devices/{id}", byId(id))),
    addConnection: (body) => coreAnswer(core.POST("/api/connections", { body: body as never })),
    patchConnection: (id, body) =>
      coreAnswer(core.PATCH("/api/connections/{id}", { ...byId(id), body: body as never })),
    deleteConnection: (id) => coreAnswer(core.DELETE("/api/connections/{id}", byId(id))),
    addIntegration: (body) => coreAnswer(byPath.POST("/api/integrations", { body })),
    patchIntegration: (id, body) => coreAnswer(byPath.PATCH(withId(id), { body })),
    deleteIntegration: (id) => coreAnswer(byPath.DELETE(withId(id))),
  };
}

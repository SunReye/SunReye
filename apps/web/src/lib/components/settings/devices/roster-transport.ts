/**
 * The roster's production adapter: each {@link RosterTransport} call is one
 * Eden treaty request, its answer narrowed to {@link Answer}. The one place the
 * treaty's `data` is cast to the contract type the server built it from. The
 * profile list is the exception: the core serves it, on the typed `core` client.
 */

import { api } from "$lib/api";
import { core } from "$lib/core-api";
import type { RegisteredProfile } from "../profile-types";
import type { Answer, RosterTransport } from "./device-roster";

/** The two fields of an Eden answer this reads. */
type EdenAnswer = { data: unknown; error: { value: unknown } | null };

async function answer<T>(request: Promise<EdenAnswer>): Promise<Answer<T>> {
  const { data, error } = await request;
  return data ? { ok: true, data: data as T } : { ok: false, error: error?.value };
}

/** The core's profile list. A dead connection throws; it is a failure with no reason, like the rest. */
async function coreProfiles(): Promise<Answer<RegisteredProfile[]>> {
  try {
    const { data, error } = await core.GET("/api/profiles");
    return data ? { ok: true, data } : { ok: false, error };
  } catch {
    return { ok: false, error: undefined };
  }
}

const device = (id: number) => api.api.devices({ id: String(id) });
const connection = (id: number) => api.api.connections({ id: String(id) });
const integration = (id: number) => api.api.integrations({ id: String(id) });

export const edenRosterTransport: RosterTransport = {
  devices: () => answer(api.api.devices.get()),
  integrations: () => answer(api.api.integrations.get()),
  catalog: () => answer(api.api.integrations.catalog.get()),
  profiles: coreProfiles,
  addDevice: (body) => answer(api.api.devices.post(body)),
  patchDevice: (id, body) => answer(device(id).patch(body)),
  deleteDevice: (id) => answer(device(id).delete()),
  addConnection: (body) => answer(api.api.connections.post(body)),
  patchConnection: (id, body) => answer(connection(id).patch(body)),
  deleteConnection: (id) => answer(connection(id).delete()),
  addIntegration: (body) => answer(api.api.integrations.post(body)),
  patchIntegration: (id, body) => answer(integration(id).patch(body)),
  deleteIntegration: (id) => answer(integration(id).delete()),
};

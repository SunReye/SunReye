/**
 * The roster's production adapter: each {@link RosterTransport} call is one
 * Eden treaty request, its answer narrowed to {@link Answer}. The one place the
 * treaty's `data` is cast to the contract type the server built it from.
 */

import { api } from "$lib/api";
import type { Answer, RosterTransport } from "./device-roster";

/** The two fields of an Eden answer this reads. */
type EdenAnswer = { data: unknown; error: { value: unknown } | null };

async function answer<T>(request: Promise<EdenAnswer>): Promise<Answer<T>> {
  const { data, error } = await request;
  return data ? { ok: true, data: data as T } : { ok: false, error: error?.value };
}

const device = (id: number) => api.api.devices({ id: String(id) });
const connection = (id: number) => api.api.connections({ id: String(id) });
const integration = (id: number) => api.api.integrations({ id: String(id) });

export const edenRosterTransport: RosterTransport = {
  devices: () => answer(api.api.devices.get()),
  integrations: () => answer(api.api.integrations.get()),
  catalog: () => answer(api.api.integrations.catalog.get()),
  profiles: () => answer(api.api.profiles.get()),
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

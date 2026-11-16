// Imported surroundings (ADR 20): the core fetches an area once when the admin asks, and serves
// the document it made of it by its digest.
import { refusal, type Client, type Problem } from "./client";
import type { components } from "./schema";

/** How the last load went, and the digest of the last document fetched. */
export type SurroundingsStatus = components["schemas"]["SurroundingsStatus"];

export type SurroundingsDocument = components["schemas"]["Imported"];

/** What to load: 100, 200 or 300 m around the plant's location, or around a more exact centre,
 * which goes to the sources for this fetch and is kept nowhere. */
export interface SurroundingsLoad {
  readonly radius: number;
  readonly centre?: Readonly<{ latitude: number; longitude: number }> | undefined;
}

export interface Surroundings {
  /** Starts a fetch; the answer comes at once and the status tells when it is ready. Admin only. */
  loadSurroundings(load: SurroundingsLoad): Promise<SurroundingsStatus | Problem>;
  /** How the last load went; admin only. */
  surroundingsStatus(): Promise<SurroundingsStatus | Problem>;
  /** A fetched document by its digest. */
  surroundings(id: string): Promise<SurroundingsDocument | Problem>;
}

export function surroundings(client: Client): Surroundings {
  return {
    loadSurroundings: async ({ radius, centre }) => {
      const { data, error, response } = await client.POST("/api/v1/surroundings", {
        body: { radius, ...centre },
      });

      return data ?? refusal(error, response.status);
    },
    surroundingsStatus: async () => {
      const { data, error, response } = await client.GET("/api/v1/surroundings");

      return data ?? refusal(error, response.status);
    },
    surroundings: async (id) => {
      const { data, error, response } = await client.GET("/api/v1/surroundings/{id}", {
        params: { path: { id } },
      });

      return data ?? refusal(error, response.status);
    },
  };
}

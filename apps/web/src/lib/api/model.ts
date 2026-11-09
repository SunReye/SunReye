// What the builder's time slider sets the PV model against (ADR 17, 20): the plant's location and
// each MPPT input's learned correction.
import { refusal, type Client, type Problem } from "./client";
import type { components } from "./schema";
import type { Location } from "./setup";

export type Corrections = components["schemas"]["CorrectionList"];

export interface PvModel {
  /** The plant's location; admin only. */
  location(): Promise<Location | Problem>;
  /** Each MPPT input's learned correction and its last 30 days against the model. */
  corrections(): Promise<Corrections | Problem>;
}

export function pvModel(client: Client): PvModel {
  return {
    location: async () => {
      const { data, error, response } = await client.GET("/api/v1/location");

      return data ?? refusal(error, response.status);
    },
    corrections: async () => {
      const { data, error, response } = await client.GET("/api/v1/corrections");

      return data ?? refusal(error, response.status);
    },
  };
}

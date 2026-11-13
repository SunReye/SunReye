// The PV layout and its module types (ADR 17, 20).
import { refusal, type Client, type Problem } from "./client";
import { body, type LayoutChange } from "./layout-change";
import type { components } from "./schema";

export type Layout = components["schemas"]["Layout"];

export type ModuleType = components["schemas"]["ModuleType"];

/** What the admin enters for a module type (ADR 17). */
export type Datasheet = components["schemas"]["Datasheet"];

export interface Layouts {
  /** The PV layout in force now. */
  layout(): Promise<Layout | Problem>;
  /** Every module type. */
  moduleTypes(): Promise<readonly ModuleType[] | Problem>;
  /** Adds a module type from its datasheet; admin only. */
  addModuleType(datasheet: Readonly<Datasheet>): Promise<ModuleType | Problem>;
  /** Changes the PV layout from an instant on; admin only. */
  changeLayout(change: LayoutChange): Promise<Layout | Problem>;
}

export function layouts(client: Client): Layouts {
  return {
    layout: async () => {
      const { data, error, response } = await client.GET("/api/v1/layout");

      return data ?? refusal(error, response.status);
    },
    moduleTypes: async () => {
      const { data, error, response } = await client.GET("/api/v1/module-types");

      return data ? data.moduleTypes : refusal(error, response.status);
    },
    addModuleType: async (datasheet) => {
      const { data, error, response } = await client.POST("/api/v1/module-types", {
        body: datasheet,
      });

      return data ?? refusal(error, response.status);
    },
    changeLayout: async (change) => {
      const { data, error, response } = await client.PUT("/api/v1/layout", { body: body(change) });

      return data ?? refusal(error, response.status);
    },
  };
}

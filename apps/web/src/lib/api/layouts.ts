// The PV layout, its module types, the uploaded car bodies the scene draws and what the PV model
// is set against (ADR 17, 20).
import { carBodies, type CarBodies } from "./car-bodies";
import { refusal, type Client, type Problem } from "./client";
import { body, type LayoutChange } from "./layout-change";
import { pvModel, type PvModel } from "./model";
import type { components } from "./schema";

export type Layout = components["schemas"]["Layout"];

export type { Types } from "./layout-change";

export type ModuleType = components["schemas"]["ModuleType"];

/** What the admin enters for a module type (ADR 17). */
export type Datasheet = components["schemas"]["Datasheet"];

/** One maker's datasheet in the module catalogue, with the power classes it prints (ADR 17). */
export type CatalogueSheet = components["schemas"]["Sheet"];

export interface Layouts extends CarBodies, PvModel {
  /** The PV layout in force now. */
  layout(): Promise<Layout | Problem>;
  /** Every module type. */
  moduleTypes(): Promise<readonly ModuleType[] | Problem>;
  /** Adds a module type from its datasheet; admin only. */
  addModuleType(datasheet: Readonly<Datasheet>): Promise<ModuleType | Problem>;
  /** The module catalogue's sheets; admin only. */
  moduleCatalogue(): Promise<readonly CatalogueSheet[] | Problem>;
  /** Changes the PV layout from an instant on; admin only. */
  changeLayout(change: LayoutChange): Promise<Layout | Problem>;
}

export function layouts(client: Client): Layouts {
  return {
    ...carBodies(client),
    ...pvModel(client),
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
    moduleCatalogue: async () => {
      const { data, error, response } = await client.GET("/api/v1/module-catalogue");

      return data ? data.sheets : refusal(error, response.status);
    },
    changeLayout: async (change) => {
      const { data, error, response } = await client.PUT("/api/v1/layout", { body: body(change) });

      return data ?? refusal(error, response.status);
    },
  };
}

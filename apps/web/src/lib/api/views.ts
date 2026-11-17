// Explore's saved views (ADR 22): every reader lists them, the admin writes them.
import { done, refusal, type Client, type Problem } from "./client";
import type { components } from "./schema";

/** A name and Explore's route query, which the core keeps as given. */
export type SavedView = components["schemas"]["SavedView"];

export interface Views {
  /** Every saved view, in the order saved. */
  views(): Promise<readonly SavedView[] | Problem>;
  /** Saves a view after the others; a taken name is refused `views.name`, a 21st `views.full`. */
  saveView(name: string, query: string): Promise<SavedView | Problem>;
  /** Replaces a view's name and query; it keeps its place. */
  replaceView(id: number, name: string, query: string): Promise<SavedView | Problem>;
  /** Removes a view. */
  removeView(id: number): Promise<Problem | undefined>;
}

export function views(client: Client): Views {
  return {
    views: async () => {
      const { data, error, response } = await client.GET("/api/v1/views");

      return data ? data.views : refusal(error, response.status);
    },
    saveView: async (name, query) => {
      const { data, error, response } = await client.POST("/api/v1/views", {
        body: { name, query },
      });

      return data ?? refusal(error, response.status);
    },
    replaceView: async (id, name, query) => {
      const { data, error, response } = await client.PUT("/api/v1/views/{id}", {
        params: { path: { id } },
        body: { name, query },
      });

      return data ?? refusal(error, response.status);
    },
    removeView: async (id) => {
      const { error, response } = await client.DELETE("/api/v1/views/{id}", {
        params: { path: { id } },
      });

      return done(error, response);
    },
  };
}

// Who else reaches the core (ADR 9): viewer accounts and integration tokens, admin only.
import { done, refusal, type Client, type Problem } from "./client";
import type { components } from "./schema";

export type Viewer = components["schemas"]["Viewer"];

export type Token = components["schemas"]["Token"];

export type Scope = components["schemas"]["Scope"];

/** A token as created: the only answer that carries the token itself. */
export type CreatedToken = components["schemas"]["Created"];

export interface Access {
  /** Every viewer account. */
  viewers(): Promise<readonly Viewer[] | Problem>;
  /** Adds a viewer; a taken name is refused `viewer.name`. */
  addViewer(name: string, password: string): Promise<Viewer | Problem>;
  /** Removes a viewer and ends its sessions. */
  removeViewer(id: number): Promise<Problem | undefined>;
  /** Every token, never the token itself. */
  tokens(): Promise<readonly Token[] | Problem>;
  /** Creates a token; the answer is the only time the token is shown. */
  addToken(name: string, scope: Scope): Promise<CreatedToken | Problem>;
  /** Revokes a token at once. */
  removeToken(id: number): Promise<Problem | undefined>;
}

export function access(client: Client): Access {
  return {
    viewers: async () => {
      const { data, error, response } = await client.GET("/api/v1/viewers");

      return data ? data.viewers : refusal(error, response.status);
    },
    addViewer: async (name, password) => {
      const { data, error, response } = await client.POST("/api/v1/viewers", {
        body: { name, password },
      });

      return data ?? refusal(error, response.status);
    },
    removeViewer: async (id) => {
      const { error, response } = await client.DELETE("/api/v1/viewers/{id}", {
        params: { path: { id } },
      });

      return done(error, response);
    },
    tokens: async () => {
      const { data, error, response } = await client.GET("/api/v1/tokens");

      return data ? data.tokens : refusal(error, response.status);
    },
    addToken: async (name, scope) => {
      const { data, error, response } = await client.POST("/api/v1/tokens", {
        body: { name, scope },
      });

      return data ?? refusal(error, response.status);
    },
    removeToken: async (id) => {
      const { error, response } = await client.DELETE("/api/v1/tokens/{id}", {
        params: { path: { id } },
      });

      return done(error, response);
    },
  };
}

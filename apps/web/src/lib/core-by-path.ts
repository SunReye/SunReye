import { core } from "./core-api";

/**
 * The core client addressed by path, for routes its generated contract does not name yet
 * (integrations, tariff, investment, spot prices). The one untyped door: each caller owns the
 * shape of the answer it reads. Drop a route from here when `core-api.gen.ts` names it.
 */
type ByPath = Record<
  "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  (path: string, init?: unknown) => Promise<{ data?: unknown; error?: unknown }>
>;
export const byPath = core as unknown as ByPath;

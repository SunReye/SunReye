import { browser } from "$app/environment";
import { goto } from "$app/navigation";
import { treaty } from "@elysiajs/eden";
// fallow-ignore-next-line boundary-violation -- Eden treaty needs the live Elysia app type (`typeof app`); it cannot be restated in @SunReye/contracts
import type { App } from "server";
import { resolve, routePath } from "./resolve";
import { serverUrl } from "./server-url";

/** Pre-auth pages — never bounce these to login (avoids a redirect loop). */
const PUBLIC_ROUTES = new Set(["/login", "/onboarding", "/setup"]);

/**
 * End-to-end type-safe client for the ElysiaJS core engine.
 *
 * HTTP:  await api.api.history.get({ query: { hours: 24, limit: 5000 } })
 *        await api.api.commands.setting.post({ key, value })
 *
 * WebSocket (live metrics):
 *        const ws = api.ws.metrics.subscribe()
 *        ws.subscribe((msg) => { console.log(msg.data) })
 */
export const api = treaty<App>(serverUrl, {
  // Send the Better Auth session cookie so the server can enforce admin-only
  // mutations (see the `requireAdmin` macro in apps/server/src/index.ts).
  fetch: { credentials: "include" },
  // Eden's date auto-coercion turns any `YYYY-MM-DD`-shaped string in a JSON
  // response into a Date object, silently breaking string period keys (e.g.
  // the cost/energy series `bucket` fields). Keep responses as-typed; callers
  // that want Dates parse explicitly.
  parseDate: false,
  // A 401 means the session expired or was never established (e.g. deleted
  // mid-session). Bounce to login via the ingress-safe resolver so stale-session
  // users aren't left staring at empty states; skip when already on a pre-auth
  // page. When the public read-only dashboard is enabled, dashboard reads don't
  // 401, so this never fires for anonymous viewers. Returning nothing lets Eden
  // continue its normal response parsing.
  onResponse(response) {
    if (
      browser &&
      response.status === 401 &&
      !PUBLIC_ROUTES.has(routePath(new URL(location.href)))
    ) {
      void goto(resolve("/login"));
    }
  },
});

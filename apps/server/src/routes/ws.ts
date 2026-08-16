/**
 * The multiplexed live socket.
 *
 * One connection replaces the five single-purpose WebSocket routes
 * (`/ws/metrics`, `/ws/evcc`, `/ws/statistics`, `/ws/logs`, `/ws/automations`).
 * A client opens `/ws`, sends `{ t: "sub", topics: [...] }`, and gets back
 * topic-tagged {@link ServerFrame}s it can narrow on instead of five sockets
 * each parsing an untagged payload.
 *
 * ## Where the access control lives
 *
 * Each of the five old routes carried its own upgrade guard, and that is
 * exactly what one URL cannot do: an upgrade runs a single policy, so `/ws`
 * rides the *weakest* one (`requireSession`, which is anonymous-capable while
 * the public read-only dashboard is on). The real gate therefore moved into the
 * message path and is re-evaluated **per subscribe frame**, from the request's
 * own headers, via {@link WsRoutesDeps.access}. Nothing about authorization is
 * captured at upgrade time — a session that expires or a role that is revoked
 * loses the admin topics on the next `sub`, and the topics it is already
 * holding are torn off the socket in the same frame (see
 * {@link ./ws-connection}). This module holds no session state at all, which is
 * what makes that structural rather than a promise.
 *
 * The stakes: `logs` carries config values, hostnames and error internals, and
 * `automations` exposes what the engine writes to the inverter's registers. A
 * wiring bug here hands both to a kiosk display. The decision itself is a pure
 * function in {@link ./ws-subscribe}, tested exhaustively; the connection state
 * machine is {@link ./ws-connection}; this file is only the route declaration.
 *
 * ## The fan-out
 *
 * Payloads reach a connection through the server's pub/sub, on the topic name
 * itself: {@link ./ws-publish} publishes there, {@link ./ws-connection} joins
 * there. The five retired routes published *bare* payloads on those same names,
 * which is why the enveloped fan-out lived under a `mux:` prefix while both
 * shipped; with the routes gone there is one namespace and no prefix.
 */

import { Elysia } from "elysia";
import { adminGuard } from "./admin-guard";
import { type WsRoutesDeps, createWsConnections } from "./ws-connection";

export type { WsRoutesDeps } from "./ws-connection";

export function wsRoutes(deps: WsRoutesDeps) {
  const handlers = createWsConnections(deps);

  return new Elysia({ name: "ws-routes" }).use(adminGuard).ws("/ws", {
    // The weakest of the five policies, because one upgrade cannot run five.
    // Everything above a dashboard read is decided per frame below.
    requireSession: true,

    // Not awaited by Elysia (`websocket.open(ws) { ws.data.open?.(ws) }`), which
    // is why `open` must register the connection synchronously before it awaits
    // anything: a conformant client sends its first `sub` from `onopen`, and
    // that frame can be delivered while this handler is still suspended.
    open: (ws) => handlers.open(ws),
    close: (ws) => handlers.close(ws),
    message: (ws, raw) => handlers.message(ws, raw),
  });
}

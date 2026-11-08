import type { SocketLike } from "./reconnecting-socket";

/** The core's `/ws` under `base`, which may carry a reverse-proxy path prefix. */
export function coreSocketUrl(base: string): string {
  return `${base.replace(/^http/, "ws")}/ws`;
}

/** A plain browser `WebSocket` in the shape {@link ReconnectingSocket} drives. */
export function openSocket(url: string): SocketLike {
  const ws = new WebSocket(url);
  return {
    subscribe: (handler) =>
      ws.addEventListener("message", (event) => handler({ data: event.data })),
    on: (event, handler) => ws.addEventListener(event, () => handler()),
    send: (data) => ws.send(data),
    close: () => ws.close(),
  };
}

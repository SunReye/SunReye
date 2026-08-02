import { describe, expect, test } from "bun:test";
import { ReconnectingSocket, type SocketLike } from "./reconnecting-socket";

/** A socket that records what happened to it and lets a test fire its events. */
class FakeSocket implements SocketLike {
  closed = 0;
  #handlers = new Map<string, () => void>();
  #message: ((message: { data: unknown }) => void) | null = null;

  subscribe(handler: (message: { data: unknown }) => void): void {
    this.#message = handler;
  }
  on(event: "open" | "close" | "error", handler: () => void): void {
    this.#handlers.set(event, handler);
  }
  close(): void {
    this.closed += 1;
  }
  emit(event: "open" | "close" | "error"): void {
    this.#handlers.get(event)?.();
  }
  push(data: unknown): void {
    this.#message?.({ data });
  }
}

function harness() {
  const sockets: FakeSocket[] = [];
  const seen: unknown[] = [];
  const socket = new ReconnectingSocket({
    create: () => {
      const ws = new FakeSocket();
      sockets.push(ws);
      return ws;
    },
    onMessage: (data) => seen.push(data),
  });
  return { socket, sockets, seen };
}

describe("ReconnectingSocket", () => {
  test("opens on the first lease and shares it with the rest", () => {
    const { socket, sockets } = harness();
    const a = socket.connect();
    const b = socket.connect();
    expect(sockets).toHaveLength(1);
    a();
    // One lease still live: the connection stays up.
    expect(sockets[0]?.closed).toBe(0);
    b();
    expect(sockets[0]?.closed).toBe(1);
  });

  test("closes for good when the last lease goes away", async () => {
    // The page releases its lease when the picked range stops including now; a
    // leaked lease would keep the server's periodic job publishing for nobody.
    const { socket, sockets } = harness();
    const release = socket.connect();
    release();
    expect(sockets[0]?.closed).toBe(1);
    // A close event on the released socket must not reopen anything.
    sockets[0]?.emit("close");
    await Bun.sleep(1200);
    expect(sockets).toHaveLength(1);
  });

  test("ignores messages from a superseded socket", () => {
    const { socket, sockets, seen } = harness();
    const release = socket.connect();
    sockets[0]?.push("live");
    release();
    sockets[0]?.push("late");
    expect(seen).toEqual(["live"]);
  });
});

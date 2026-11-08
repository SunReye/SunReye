import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { coreSocketUrl, openSocket } from "./browser-socket";

type Listener = (event: { data?: unknown }) => void;

/** Just enough of a browser WebSocket: records the URL, its listeners, what was sent. */
class FakeWebSocket {
  static opened: FakeWebSocket[] = [];
  listeners = new Map<string, Listener[]>();
  sent: string[] = [];
  closed = 0;
  constructor(readonly url: string) {
    FakeWebSocket.opened.push(this);
  }
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed += 1;
  }
  emit(type: string, event: { data?: unknown } = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const realWebSocket = globalThis.WebSocket;
beforeEach(() => {
  FakeWebSocket.opened = [];
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
});
afterEach(() => {
  globalThis.WebSocket = realWebSocket;
});

describe("coreSocketUrl", () => {
  test.each([
    ["http://host:3000", "ws://host:3000/ws"],
    ["https://host", "wss://host/ws"],
    // Home Assistant ingress: the socket must stay under the token prefix.
    ["https://ha/api/hassio_ingress/tok", "wss://ha/api/hassio_ingress/tok/ws"],
  ])("%s -> %s", (base, expected) => {
    expect(coreSocketUrl(base)).toBe(expected);
  });
});

describe("openSocket", () => {
  test("opens the given url", () => {
    openSocket("ws://host/ws");
    expect(FakeWebSocket.opened.map((s) => s.url)).toEqual(["ws://host/ws"]);
  });

  test("hands each message's data to the subscriber", () => {
    const socket = openSocket("ws://host/ws");
    const seen: unknown[] = [];
    socket.subscribe((message) => seen.push(message.data));
    FakeWebSocket.opened[0]!.emit("message", { data: '{"topic":"metrics"}' });
    expect(seen).toEqual(['{"topic":"metrics"}']);
  });

  test.each(["open", "close", "error"] as const)("reports %s", (event) => {
    const socket = openSocket("ws://host/ws");
    let fired = 0;
    socket.on(event, () => (fired += 1));
    FakeWebSocket.opened[0]!.emit(event);
    expect(fired).toBe(1);
  });

  test("an event is reported only to its own listeners", () => {
    const socket = openSocket("ws://host/ws");
    let fired = 0;
    socket.on("open", () => (fired += 1));
    FakeWebSocket.opened[0]!.emit("close");
    expect(fired).toBe(0);
  });

  test("send and close reach the socket", () => {
    const socket = openSocket("ws://host/ws");
    socket.send('{"t":"sub","topics":["metrics"]}');
    socket.close();
    expect(FakeWebSocket.opened[0]!.sent).toEqual(['{"t":"sub","topics":["metrics"]}']);
    expect(FakeWebSocket.opened[0]!.closed).toBe(1);
  });
});

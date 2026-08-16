import { describe, expect, test } from "bun:test";
import type { EvccLoadpoint, EvccState } from "@SunReye/contracts/evcc";
import { LiveBus } from "$lib/ws/bus";
import type { SocketLike } from "$lib/ws/reconnecting-socket";
import { EvccFeed, evccStalenessCadenceMs, isActive, leaseEvcc, totalChargePower } from "./feed";

function loadpoint(patch: Partial<EvccLoadpoint> = {}): EvccLoadpoint {
  return {
    index: 1,
    title: "Carport",
    mode: "pv",
    chargePower: 0,
    chargePowerLive: 0,
    chargePowerSource: "measured",
    charging: false,
    connected: false,
    vehicleSoc: null,
    vehicleRange: null,
    vehicleTitle: null,
    vehicleName: null,
    sessionEnergy: null,
    chargeRemainingEnergy: null,
    limitSoc: null,
    effectiveLimitSoc: null,
    vehicleLimitSoc: null,
    batteryBoost: false,
    batteryBoostLimit: 100,
    ...patch,
  } as EvccLoadpoint;
}

function state(patch: Partial<EvccState> = {}): EvccState {
  return { reachable: true, loadpoints: [], ...patch } as EvccState;
}

interface Harness {
  feed: EvccFeed;
  states: EvccState[];
  cadence: number[];
  tick(ms: number): void;
}

function harness(): Harness {
  const states: EvccState[] = [];
  const cadence: number[] = [];
  let clock = 0;
  const feed = new EvccFeed({
    onState: (next) => states.push(next),
    onCadence: (ms) => cadence.push(ms),
    now: () => clock,
  });
  return {
    feed,
    states,
    cadence,
    tick: (ms) => {
      clock += ms;
    },
  };
}

/** A socket that records what was written and can push frames back. */
class FakeSocket implements SocketLike {
  sent: string[] = [];
  #handlers = new Map<string, () => void>();
  #message: ((message: { data: unknown }) => void) | null = null;
  subscribe(handler: (message: { data: unknown }) => void): void {
    this.#message = handler;
  }
  on(event: "open" | "close" | "error", handler: () => void): void {
    this.#handlers.set(event, handler);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {}
  emit(event: "open"): void {
    this.#handlers.get(event)?.();
  }
  /** Deliver a frame the way the transport does — as the raw JSON text. */
  push(data: unknown): void {
    this.#message?.({ data });
  }
}

describe("EvccFeed", () => {
  test("the first frame publishes the state and leaves the cadence at its seed", () => {
    // Nothing to measure a spacing against yet — reporting a gap here would be
    // reporting the time since the page loaded.
    const h = harness();
    const first = state({ loadpoints: [loadpoint()] });
    h.feed.apply(first);
    expect(h.states).toEqual([first]);
    expect(h.cadence).toEqual([1000]);
  });

  test("the cadence follows the spacing between arrivals, smoothed", () => {
    const h = harness();
    h.feed.apply(state());
    h.tick(6000);
    h.feed.apply(state());
    // 6 s smoothed (α=0.3) against the 1 s seed.
    expect(h.cadence.at(-1)).toBeCloseTo(2500, 5);
  });

  test("a burst faster than 500 ms and a quiet spell longer than 10 s are both clamped", () => {
    // EVCC publishes on change, not on a poll: a flurry of MQTT retains would
    // otherwise drive the glide to zero, and an idle night would stretch it
    // past any animation worth watching.
    const fast = harness();
    fast.feed.apply(state());
    fast.tick(1);
    fast.feed.apply(state());
    expect(fast.cadence.at(-1)).toBeCloseTo(850, 5); // 1000*0.7 + 500*0.3

    const slow = harness();
    slow.feed.apply(state());
    slow.tick(600_000);
    slow.feed.apply(state());
    expect(slow.cadence.at(-1)).toBeCloseTo(3700, 5); // 1000*0.7 + 10_000*0.3
  });

  test("an unreachable EVCC or one with no loadpoints is not active", () => {
    expect(isActive(null)).toBe(false);
    expect(isActive(state({ reachable: false, loadpoints: [loadpoint()] }))).toBe(false);
    expect(isActive(state({ reachable: true, loadpoints: [] }))).toBe(false);
    expect(isActive(state({ reachable: true, loadpoints: [loadpoint()] }))).toBe(true);
  });

  test("charge power sums the live estimate across loadpoints", () => {
    // The live figure, not EVCC's last publish: it moves at the inverter's 1 Hz
    // cadence, which is what the diagram animates against.
    expect(totalChargePower(null)).toBe(0);
    expect(totalChargePower(state())).toBe(0);
    expect(
      totalChargePower(
        state({
          loadpoints: [
            loadpoint({ index: 1, chargePower: 7000, chargePowerLive: 4200 }),
            loadpoint({ index: 2, chargePowerLive: 0 }),
          ],
        }),
      ),
    ).toBe(4200);
  });
});

describe("the freshness window is not the glide clamp", () => {
  test("a charger on its normal slow loop is judged against that loop, not the 10 s glide", () => {
    // The measured cadence is clamped to 10 s so an idle night cannot stretch
    // an animation past watching. Judging freshness by that same 10 s says a
    // charger is dead 30 s after its last push — and EVCC's own publish loop is
    // 10–30 s, with the server emitting purely on change and no heartbeat. The
    // window has to clear one healthy quiet loop with room to spare.
    expect(evccStalenessCadenceMs(10_000)).toBe(30_000);
    expect(evccStalenessCadenceMs(500)).toBe(30_000);
  });

  test("a charger that genuinely publishes faster is not held to the floor", () => {
    // The floor is a floor: a broker pushing every minute (a retained-state
    // replay after a long silence) should widen the window, never narrow it.
    expect(evccStalenessCadenceMs(60_000)).toBe(60_000);
  });
});

describe("leaseEvcc", () => {
  test("three leases cost one sub frame, and one unsub when the last goes away", () => {
    // The EV card, the power-flow diagram and the peak-shaving panel are on
    // screen together. Subscribing per component would re-prime the server's
    // backfill for the two that already have it; unsubscribing per component
    // would cut the feed out from under the other two.
    const socket = new FakeSocket();
    const bus = new LiveBus({
      create: () => socket,
      onConnected: () => {},
      onCadence: () => {},
    });
    bus.connect();
    socket.emit("open");
    const h = harness();
    const leases = [leaseEvcc(bus, h.feed), leaseEvcc(bus, h.feed), leaseEvcc(bus, h.feed)];
    expect(socket.sent.map((raw) => JSON.parse(raw))).toEqual([{ t: "sub", topics: ["evcc"] }]);
    const [card, diagram, panel] = leases;
    card?.();
    diagram?.();
    expect(socket.sent).toHaveLength(1);
    panel?.();
    expect(socket.sent.map((raw) => JSON.parse(raw))).toEqual([
      { t: "sub", topics: ["evcc"] },
      { t: "unsub", topics: ["evcc"] },
    ]);
  });

  test("the first push after an outage is not measured across it", () => {
    // EVCC publishes when its MQTT topics move, so the feed keeps its own
    // spacing estimate rather than the bus's. Only the bus knows the socket
    // died: without a resume signal the first push back stretches the glide to
    // the length of the outage, and every EV number crawls for minutes.
    //
    // Driven through the bus rather than by calling `feed.resume()` directly,
    // so the lease's wiring is what this pins — calling the method by hand
    // passes just as happily with the two ends never connected.
    const socket = new FakeSocket();
    const bus = new LiveBus({
      create: () => socket,
      onConnected: () => {},
      onCadence: () => {},
    });
    bus.connect();
    socket.emit("open");
    const h = harness();
    leaseEvcc(bus, h.feed);

    h.feed.apply(state());
    h.tick(6000);
    h.feed.apply(state());
    expect(h.cadence.at(-1)).toBeCloseTo(2500, 5);

    socket.emit("open"); // the reconnect the bus reports to its subscribers
    h.tick(600_000);
    h.feed.apply(state());
    expect(h.cadence.at(-1)).toBeCloseTo(2500, 5);
  });

  test("a frame off the bus reaches the feed", () => {
    const socket = new FakeSocket();
    const bus = new LiveBus({
      create: () => socket,
      onConnected: () => {},
      onCadence: () => {},
    });
    bus.connect();
    socket.emit("open");
    const h = harness();
    leaseEvcc(bus, h.feed);
    const pushed = state({ loadpoints: [loadpoint({ chargePowerLive: 1500 })] });
    socket.push(JSON.stringify({ topic: "evcc", data: pushed }));
    expect(h.states).toEqual([pushed]);
  });
});

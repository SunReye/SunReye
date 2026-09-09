import { describe, expect, test } from "bun:test";
import type { PlantSample } from "@SunReye/contracts/ws";
import type { InverterSample } from "@SunReye/inverter-core";
import { createStreams } from "../shared/streams";
import { startPlantLive } from "./plant-live";

const sample = (
  inverterId: string,
  time: number,
  metrics: Record<string, number>,
): InverterSample => ({
  time: new Date(time).toISOString(),
  inverterId,
  metrics,
});

const KIND = (m: string) =>
  m === "pv.power" ? "sum" : m === "battery.soc" ? "weighted-mean" : "per-device";

function harness(
  members: Array<{ id: number; slug: string; profileId?: string; weight: number }> = [
    { id: 1, slug: "a", weight: 10 },
    { id: 2, slug: "b", weight: 5 },
  ],
) {
  const streams = createStreams();
  const published: PlantSample[] = [];
  streams.subscribe("plant", (p) => published.push(p));
  let clock = 100_000;
  let memberReads = 0;
  const live = startPlantLive({
    streams,
    members: async () => {
      memberReads += 1;
      return members;
    },
    aggregateOf: KIND,
    now: () => clock,
    staleAfterMs: 5_000,
    membersTtlMs: 1_000,
  });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return {
    streams,
    published,
    live,
    tick,
    advance: (ms: number) => (clock += ms),
    reads: () => memberReads,
  };
}

describe("startPlantLive", () => {
  test("each device sample re-folds the plant and publishes it", async () => {
    const h = harness();
    h.streams.emit(
      "metrics",
      sample("a", 100_000, { "pv.power": 100, "battery.soc": 100, "grid.v": 230 }),
    );
    await h.tick();
    h.streams.emit("metrics", sample("b", 100_500, { "pv.power": 50, "battery.soc": 40 }));
    await h.tick();
    expect(h.published).toHaveLength(2);
    expect(h.published[1]).toEqual({
      time: new Date(100_500).toISOString(),
      metrics: { "pv.power": 150, "battery.soc": 80 },
      members: ["a", "b"],
      stale: [],
    });
    expect(h.live.snapshot()).toEqual(h.published[1]!);
  });

  test("before the second device has spoken it is stale, and the first speaks alone", async () => {
    const h = harness();
    h.streams.emit("metrics", sample("a", 100_000, { "pv.power": 100 }));
    await h.tick();
    expect(h.published[0]).toMatchObject({ metrics: { "pv.power": 100 }, stale: ["b"] });
  });

  test("a device that stops answering drops out of the sum after the stale window", async () => {
    const h = harness();
    h.streams.emit("metrics", sample("b", 100_000, { "pv.power": 50 }));
    await h.tick();
    h.advance(10_000);
    h.streams.emit("metrics", sample("a", 110_000, { "pv.power": 100 }));
    await h.tick();
    expect(h.published.at(-1)).toMatchObject({ metrics: { "pv.power": 100 }, stale: ["b"] });
  });

  test("a sample from a device that is not a member is ignored by the fold", async () => {
    const h = harness();
    h.streams.emit("metrics", sample("ghost", 100_000, { "pv.power": 999 }));
    await h.tick();
    expect(h.published[0]?.metrics).toEqual({});
    expect(h.published[0]?.members).toEqual(["a", "b"]);
  });

  test("the member set is re-read at most once per TTL", async () => {
    const h = harness();
    for (let i = 0; i < 5; i += 1) {
      h.streams.emit("metrics", sample("a", 100_000 + i, { "pv.power": 1 }));
      await h.tick();
    }
    expect(h.reads()).toBe(1);
    h.advance(1_500);
    h.streams.emit("metrics", sample("a", 101_500, { "pv.power": 1 }));
    await h.tick();
    expect(h.reads()).toBe(2);
  });

  test("no sample yet means no snapshot to replay", () => {
    expect(harness().live.snapshot()).toBeNull();
  });

  test("stop detaches: later samples publish nothing", async () => {
    const h = harness();
    h.live.stop();
    h.streams.emit("metrics", sample("a", 100_000, { "pv.power": 1 }));
    await h.tick();
    expect(h.published).toHaveLength(0);
  });
});

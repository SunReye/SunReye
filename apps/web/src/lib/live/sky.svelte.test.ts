import { flushSync } from "svelte";
import { expect, test, vi } from "vitest";
import { connect } from "../api/core.ts";
import { eachSeries } from "../api/core.harness.ts";
import { LiveSky } from "./sky.svelte.ts";

/** A core whose weather forecast is `ghi` and `dhi` W/m² through every span asked. */
function weatherCore(ghi: number, dhi: number) {
  const asked: Readonly<{ series: string | null; from: number; to: number }>[] = [];

  const core = connect({
    base: "http://core.test/",
    fetch: (request) => {
      const url = new URL(request.url);

      // A quarter-hour step that began 15 minutes before now.
      const target = new Date(Date.parse(url.searchParams.get("from") ?? "") + 45 * 60_000);

      // The weather device stores no history here: nothing measured the sky.
      if (url.pathname.endsWith("/history"))
        return Promise.resolve(eachSeries(request.url, () => ({ tier: "raw", points: [] })));

      if (url.pathname.endsWith("/devices/4294967295/forecasts"))
        for (const series of url.searchParams.getAll("series"))
          asked.push({
            series,
            from: Date.parse(url.searchParams.get("from") ?? ""),
            to: Date.parse(url.searchParams.get("to") ?? ""),
          });

      return Promise.resolve(
        eachSeries(request.url, (series) => ({
          points: [
            {
              issued: url.searchParams.get("from"),
              target: target.toISOString(),
              value: series === "weather.dhi" ? dhi : ghi,
            },
          ],
        })),
      );
    },
  });

  return { core, asked };
}

test("the dashboard's sky is the weather forecast in force now", async () => {
  const { core, asked } = weatherCore(300, 285);
  const before = Date.now();
  let sky: LiveSky | undefined;

  const stop = $effect.root(() => {
    sky = new LiveSky(() => core);
  });

  flushSync();
  expect(sky?.weather.cloud).toBeNull();
  // Midway between the diffuse share, 0.95, and the cloud cover, which answers as closed.
  await expect.poll(() => sky?.weather.cloud).toBeCloseTo(0.975);
  // Every forecast quantity answers alike here, the weather code too.
  expect(sky?.weather.code).toBe(300);

  expect(asked.map(({ series }) => series)).toEqual(
    expect.arrayContaining(["weather.ghi", "weather.dhi", "weather.code"]),
  );
  // The forecast step in force now lies in the span.
  expect(asked[0]?.from).toBeLessThanOrEqual(before - 3_600_000 + 1000);
  expect(asked[0]?.to).toBeGreaterThan(before);
  stop();
});

/** A core that measured a closed sky from `start`'s 20 to 5 minutes before, and whose answers
 * wait while `hold` is set. */
function measuredCore(start: number) {
  const iso = (minutes: number) => new Date(start + minutes * 60_000).toISOString();
  const held: (() => void)[] = [];
  const state = { hold: false, held };

  const core = connect({
    base: "http://core.test/",
    fetch: async (request) => {
      const url = new URL(request.url);

      if (state.hold) {
        await new Promise<void>((release) => {
          state.held.push(release);
        });
      }

      return eachSeries(request.url, (series) => ({
        tier: "raw",
        points:
          series === "weather.clearness" && url.pathname.endsWith("/history")
            ? [{ start: iso(-20), end: iso(-5), mean: 0.25 }]
            : [],
      }));
    },
  });

  return { core, state };
}

test("as now moves on, the last weather stands until the next is read: nothing lapses between", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  // Five minutes into a quarter: the one before it is the last the core closed.
  vi.setSystemTime(new Date("2026-11-14T12:05:00Z"));

  const { core, state } = measuredCore(Date.now());
  let sky: LiveSky | undefined;

  const stop = $effect.root(() => {
    sky = new LiveSky(() => core);
  });

  flushSync();
  // The index stands until the next quarter has closed.
  await vi.waitFor(() => {
    expect(sky?.weather.clearSkyIndex).toBe(0.25);
  });

  state.hold = true;
  vi.advanceTimersByTime(15 * 60_000);
  flushSync();
  await vi.waitFor(() => {
    expect(state.held.length).toBeGreaterThan(0);
  });
  expect(sky?.weather.clearSkyIndex).toBe(0.25);

  state.hold = false;

  for (const release of state.held) release();

  // Read again a quarter on, the index has lapsed.
  await vi.waitFor(() => {
    expect(sky?.weather.clearSkyIndex).toBeNull();
  });
  stop();
  vi.useRealTimers();
});

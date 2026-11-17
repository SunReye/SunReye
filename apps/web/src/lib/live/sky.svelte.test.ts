import { flushSync } from "svelte";
import { expect, test } from "vitest";
import { connect } from "../api/core.ts";
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
        return Promise.resolve(Response.json({ tier: "raw", points: [] }));

      if (url.pathname.endsWith("/devices/4294967295/forecasts"))
        asked.push({
          series: url.searchParams.get("series"),
          from: Date.parse(url.searchParams.get("from") ?? ""),
          to: Date.parse(url.searchParams.get("to") ?? ""),
        });

      return Promise.resolve(
        Response.json({
          points: [
            {
              issued: url.searchParams.get("from"),
              target: target.toISOString(),
              value: url.searchParams.get("series") === "weather.dhi" ? dhi : ghi,
            },
          ],
        }),
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
  await expect.poll(() => sky?.weather.cloud).toBeCloseTo(0.95);
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

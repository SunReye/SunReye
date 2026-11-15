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
              value: url.searchParams.get("series") === "weather.ghi" ? ghi : dhi,
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
  expect(sky?.diffuse).toBeNull();
  await expect.poll(() => sky?.diffuse).toBeCloseTo(0.95);

  expect(new Set(asked.map(({ series }) => series))).toEqual(
    new Set(["weather.ghi", "weather.dhi"]),
  );
  // The forecast step in force now lies in the span.
  expect(asked[0]?.from).toBeLessThanOrEqual(before - 3_600_000 + 1000);
  expect(asked[0]?.to).toBeGreaterThan(before);
  stop();
});

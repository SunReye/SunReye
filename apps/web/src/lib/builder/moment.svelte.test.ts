import { flushSync } from "svelte";
import { expect, test } from "vitest";
import { connect } from "../api/core.ts";
import { eachSeries } from "../api/core.harness.ts";
import { pv } from "./builder.harness.ts";
import { homeRecords } from "./records.ts";
import { emptyDraft } from "../../../../../packages/builder/src/builder/modules.ts";
import type { SceneWeather } from "../../../../../packages/builder/src/scene/weather.ts";
import { Moment } from "../../../../../packages/builder/src/builder/moment.svelte.ts";

const QUARTER = 15 * 60_000;

/** A core whose weather forecast is 1 in every series through the span asked: a metre of
 * visibility, snowfall and lying snow. Nothing is measured. */
const snowedIn = connect({
  base: "http://core.test/",
  fetch: (request) => {
    const url = new URL(request.url);

    if (url.pathname.endsWith("/history"))
      return Promise.resolve(eachSeries(request.url, () => ({ tier: "raw", points: [] })));

    const from = Date.parse(url.searchParams.get("from") ?? "");
    const to = Date.parse(url.searchParams.get("to") ?? "");
    const points: { issued: string; target: string; value: number }[] = [];

    for (let at = from; at < to; at += QUARTER) {
      points.push({
        issued: new Date(from).toISOString(),
        target: new Date(at).toISOString(),
        value: 1,
      });
    }

    return Promise.resolve(eachSeries(request.url, () => ({ points })));
  },
});

/** The scene's weather at the slider's instant over the snowed-in core, the admin editing or not. */
async function snowed(editing: boolean): Promise<SceneWeather | undefined> {
  let moment: Moment | undefined;

  const unmount = $effect.root(() => {
    moment = new Moment(
      () => ({
        core: homeRecords(snowedIn),
        pv,
        draft: emptyDraft(),
        moduleTypes: [],
        location: undefined,
      }),
      () => editing,
    );
  });

  flushSync();

  try {
    await expect.poll(() => moment?.weather.snowfall).toBe(1);
    expect(moment?.weather.visibility).toBe(1);

    return moment?.scene;
  } finally {
    unmount();
  }
}

test("the admin edits without fog, wet ground, what falls and the glass; the light and lying snow follow the instant", async () => {
  expect(await snowed(true)).toMatchObject({
    fog: 0,
    wet: 0,
    falling: null,
    glass: null,
    snow: true,
  });
});

test("outside editing the time slider shows the weather as the dashboard does", async () => {
  const scene = await snowed(false);

  expect(scene).toMatchObject({ fog: 1, wet: 1, snow: true, falling: { kind: "snow" } });
  expect(scene?.glass).not.toBeNull();
});

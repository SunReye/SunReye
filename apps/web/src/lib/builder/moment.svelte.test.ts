import { flushSync } from "svelte";
import { expect, test } from "vitest";
import { connect } from "../api/core.ts";
import { emptyDraft } from "./modules.ts";
import { Moment } from "./moment.svelte.ts";
import type { Pv } from "./pv.ts";

const QUARTER = 15 * 60_000;

/** A core whose weather forecast is 1 in every series through the span asked: a metre of
 * visibility, snowfall and lying snow. Nothing is measured. */
const snowedIn = connect({
  base: "http://core.test/",
  fetch: (request) => {
    const url = new URL(request.url);

    if (url.pathname.endsWith("/history"))
      return Promise.resolve(Response.json({ tier: "raw", points: [] }));

    const from = Date.parse(url.searchParams.get("from") ?? "");
    const to = Date.parse(url.searchParams.get("to") ?? "");
    const points = [];

    for (let at = from; at < to; at += QUARTER) {
      points.push({ issued: new Date(from).toISOString(), target: new Date(at).toISOString(), value: 1 });
    }

    return Promise.resolve(Response.json({ points }));
  },
});

test("the admin edits without fog, what falls and the glass; the light and lying snow follow the instant", async () => {
  let moment: Moment | undefined;

  const unmount = $effect.root(() => {
    moment = new Moment(() => ({
      core: snowedIn,
      // Never asked: the plant's location is unknown.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      pv: {} as Pv,
      draft: emptyDraft(),
      moduleTypes: [],
      location: undefined,
    }));
  });

  flushSync();

  try {
    await expect.poll(() => moment?.weather.snowfall).toBe(1);
    expect(moment?.weather.visibility).toBe(1);
    expect(moment?.scene).toMatchObject({ fog: 0, falling: null, glass: null, snow: true });
  } finally {
    unmount();
  }
});

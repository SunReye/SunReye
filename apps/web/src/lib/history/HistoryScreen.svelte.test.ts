import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { connect, type Transport } from "../api/core.ts";
import HistoryScreen from "./HistoryScreen.svelte";

/** The plant device and a battery. */
const SNAPSHOT =
  '{"devices":{"4294967294":{"pv.power":1950,"grid.power":-120},"7":{"battery.soc":64}}}';

/** Two plant-local days of 2.5 kWh and 12.25 kWh. */
const STATISTICS = {
  period: "day",
  points: [
    {
      date: "2026-11-07",
      start: "2026-11-06T23:00:00Z",
      end: "2026-11-07T23:00:00Z",
      mean: 104.16,
      min: 0,
      max: 900,
      integral: 2500,
    },
    {
      date: "2026-11-08",
      start: "2026-11-07T23:00:00Z",
      end: "2026-11-08T23:00:00Z",
      mean: 510.42,
      min: 0,
      max: 3100,
      integral: 12_250,
    },
  ],
};

/** A test core: one live snapshot, then a held stream; history and statistics as above. */
function testCore(): Transport & { readonly asked: string[] } {
  const asked: string[] = [];
  let streams = 0;

  return {
    base: "http://core.test/",
    asked,
    fetch: (request) => {
      const url = new URL(request.url);

      if (url.pathname.endsWith("/live")) {
        streams += 1;

        return streams === 1
          ? Promise.resolve(
              new Response(`event: snapshot\ndata: ${SNAPSHOT}\n\n`, {
                headers: { "content-type": "text/event-stream" },
              }),
            )
          : Promise.withResolvers<Response>().promise;
      }

      asked.push(url.pathname + url.search);

      if (url.pathname.endsWith("/statistics")) return Promise.resolve(Response.json(STATISTICS));

      const points = [{ start: "2026-11-09T08:00:00Z", end: "2026-11-09T08:01:00Z", mean: 900 }];

      return Promise.resolve(Response.json({ tier: "bucket", width: 60, points }));
    },
  };
}

test("the screen charts the chosen device's series on canvas", async () => {
  const transport = testCore();

  const screen = await render(HistoryScreen, { core: connect(transport) });

  await expect
    .poll(() => transport.asked.filter((path) => path.includes("/history")))
    .toEqual([
      expect.stringMatching(/^\/api\/v1\/devices\/4294967294\/history\?series=grid\.power&from=/u),
    ]);
  await expect.poll(() => screen.container.querySelector("figure canvas")).not.toBeNull();

  await screen.getByRole("combobox", { name: "Gerät" }).selectOptions("Gerät 7");

  await expect
    .poll(() =>
      transport.asked.some((path) =>
        path.startsWith("/api/v1/devices/7/history?series=battery.soc&"),
      ),
    )
    .toBe(true);
});

test("the screen lists each plant-local day's energy from the core", async () => {
  const transport = testCore();

  const screen = await render(HistoryScreen, { core: connect(transport) });
  await screen.getByRole("combobox", { name: "Reihe" }).selectOptions("pv.power");

  await expect.element(screen.getByRole("cell", { name: "2,5 kWh" })).toBeVisible();
  await expect.element(screen.getByRole("cell", { name: "12,25 kWh" })).toBeVisible();
  await expect
    .poll(() =>
      transport.asked.some((path) =>
        /\/4294967294\/statistics\?series=pv\.power&period=day&/u.test(path),
      ),
    )
    .toBe(true);

  await screen.getByRole("combobox", { name: "Zeitraum" }).selectOptions("Woche");

  await expect
    .poll(() =>
      transport.asked.some((path) =>
        /\/4294967294\/statistics\?series=pv\.power&period=week&/u.test(path),
      ),
    )
    .toBe(true);
});

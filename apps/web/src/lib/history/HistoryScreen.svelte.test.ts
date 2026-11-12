import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
// The chart is laid out by the SPA's utilities.
import "../../app.css";
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

      if (url.pathname.endsWith("/timezone")) {
        return Promise.resolve(Response.json({ name: "Europe/Berlin" }));
      }

      asked.push(url.pathname + url.search);

      if (url.pathname.endsWith("/statistics")) return Promise.resolve(Response.json(STATISTICS));

      // 3 kWh on the morning of 2026-11-03.
      const points = [
        { start: "2026-11-03T08:00:00Z", end: "2026-11-03T09:00:00Z", mean: 2000 },
        { start: "2026-11-03T09:00:00Z", end: "2026-11-03T10:00:00Z", mean: 1000 },
      ];

      return Promise.resolve(Response.json({ tier: "bucket", width: 60, points }));
    },
  };
}

/** The screen at `query`, and every route change it makes. */
function at(query: string) {
  const went: { patch: Readonly<Record<string, string | null>>; push: boolean }[] = [];

  return {
    went,
    params: new URLSearchParams(query),
    go: (patch: Readonly<Record<string, string | null>>, push: boolean) =>
      went.push({ patch, push }),
  };
}

test("the range in the route picks the plant-local hours the chart reads", async () => {
  const transport = testCore();

  await render(HistoryScreen, { core: connect(transport), ...at("range=day&at=2026-11-03") });

  await expect
    .poll(() => transport.asked.filter((path) => path.includes("/history")))
    .toContainEqual(
      "/api/v1/devices/4294967294/history?series=grid.power&from=2026-11-02T23%3A00%3A00.000Z&to=2026-11-03T23%3A00%3A00.000Z",
    );
});

test("the legend reads the range's energy, and an earlier step goes into the route", async () => {
  const transport = testCore();
  const route = at("range=day&at=2026-11-03");

  const screen = await render(HistoryScreen, { core: connect(transport), ...route });
  await screen.getByRole("combobox", { name: "Reihe" }).selectOptions("pv.power");

  await expect.element(screen.getByText("3,0 kWh", { exact: true })).toBeVisible();

  await screen.getByRole("button", { name: "Früher" }).click();

  await expect.element(screen.getByText("Mo., 2. November")).toBeVisible();
  await expect
    .poll(() => route.went)
    .toEqual([{ patch: { range: "day", at: "2026-11-02", from: null, to: null }, push: false }]);
});

test("another device charts its own series", async () => {
  const transport = testCore();

  const screen = await render(HistoryScreen, { core: connect(transport), ...at("") });

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

  const screen = await render(HistoryScreen, { core: connect(transport), ...at("") });
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

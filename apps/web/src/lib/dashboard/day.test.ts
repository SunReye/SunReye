import { expect, test } from "bun:test";
import { connect } from "../api/core.ts";
import { readDay } from "./day.ts";

/** Each history, statistics and forecast read, as its route, series and `from`. */
function fake(zone: string) {
  const asked: Readonly<{
    route: string;
    series: string | null;
    from: string | null;
  }>[] = [];

  const core = connect({
    base: "http://core.test/",
    fetch: (request) => {
      const url = new URL(request.url);
      const route = url.pathname.split("/").at(-1) ?? "";

      if (route === "timezone")
        return Promise.resolve(Response.json({ name: zone }));

      if (["history", "statistics", "forecasts"].includes(route))
        asked.push({
          route,
          series: url.searchParams.get("series"),
          from: url.searchParams.get("from"),
        });

      return Promise.resolve(Response.json({ points: [], strings: [] }));
    },
  });

  return { asked, core };
}

test("the dashboard's day names each series and starts at the plant's midnight (#699)", async () => {
  // UTC+14 all year: its midnight is 10:00 UTC the day before, whatever the viewer's zone.
  const { asked, core } = fake("Pacific/Kiritimati");

  await readDay(core, new Date("2026-11-10T08:00:00Z"));

  // The weather is read around now, not by the day.
  const days = asked.filter((a) => !(a.series ?? "").startsWith("weather."));

  expect(days.length).toBeGreaterThan(0);
  expect(asked.every((a) => (a.series ?? "") !== "")).toBe(true);
  expect(new Set(days.map((a) => a.from))).toEqual(
    new Set(["2026-11-09T10:00:00.000Z"]),
  );
});

test("the day's weather is the weather device's at the instant it was read", async () => {
  const now = new Date("2026-11-10T08:05:00Z");

  const core = connect({
    base: "http://core.test/",
    fetch: (request) => {
      const url = new URL(request.url);
      const series = url.searchParams.get("series");
      const weather = url.pathname.endsWith("/devices/4294967295/forecasts");

      if (url.pathname.endsWith("/timezone"))
        return Promise.resolve(Response.json({ name: "UTC" }));

      const points = [
        {
          issued: "2026-11-10T07:00:00Z",
          target: "2026-11-10T07:45:00Z",
          value: 61,
        },
        {
          issued: "2026-11-10T07:00:00Z",
          target: "2026-11-10T08:00:00Z",
          value: 71,
        },
        {
          issued: "2026-11-10T07:00:00Z",
          target: "2026-11-10T08:15:00Z",
          value: 3,
        },
      ];

      return Promise.resolve(
        Response.json({
          points: weather && series === "weather.code" ? points : [],
          strings: [],
        }),
      );
    },
  });

  const day = await readDay(core, now);

  expect(day.weather).toMatchObject({ code: 71, celsius: null, cloud: null });
});

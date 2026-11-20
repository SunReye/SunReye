/// <reference types="bun" />
import { afterEach, expect, test } from "bun:test";
import { type CatalogDevice, connect, http } from "./core.ts";
import { BASE, problem, scripted } from "./core.harness.ts";

let server: ReturnType<typeof Bun.serve> | undefined;

afterEach(async () => {
  await server?.stop(true);
});

test("history asks the core under its prefix for its series over a range", async () => {
  const asked: string[] = [];
  server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const url = new URL(request.url);
      asked.push(url.pathname + url.search);

      return Response.json({
        series: [
          {
            series: "pv.power",
            tier: "bucket",
            width: 60,
            points: [{ start: "2026-11-09T00:00:00Z", end: "2026-11-09T00:01:00Z", mean: 412.5 }],
          },
          { series: "load.power", tier: "raw", points: [] },
        ],
      });
    },
  });
  const core = connect(http(`http://127.0.0.1:${server.port}/prefix/`));

  const history = await core.history(
    1,
    ["pv.power", "load.power"],
    new Date("2026-11-09T00:00:00Z"),
    new Date("2026-11-09T12:00:00Z"),
  );

  expect(asked).toEqual([
    "/prefix/api/v1/devices/1/history?series=pv.power&series=load.power&from=2026-11-09T00%3A00%3A00.000Z&to=2026-11-09T12%3A00%3A00.000Z",
  ]);
  expect(history).toEqual([
    {
      series: "pv.power",
      tier: "bucket",
      width: 60,
      points: [{ start: "2026-11-09T00:00:00Z", end: "2026-11-09T00:01:00Z", mean: 412.5 }],
    },
    { series: "load.power", tier: "raw", points: [] },
  ]);
});

test("a refused history read reports the problem code", async () => {
  const core = connect(scripted(problem(422, "history.range")));

  const history = await core.history(1, ["pv.power"], new Date(0), new Date(0));

  expect(history).toEqual([{ problem: "history.range" }]);
});

/** A test core that records each request with its method and body. */

test("the series catalog lists each device with stored history", async () => {
  const device: CatalogDevice = {
    id: 3,
    name: "Garage",
    removed: true,
    series: [
      {
        series: "pv.mppt.power[2]",
        kind: "measurement",
        unit: "W",
        estimated: false,
        first: "2026-08-25T00:00:00Z",
        last: "2026-08-26T12:01:00Z",
      },
    ],
  };

  const transport = scripted(Response.json({ devices: [device] }));

  expect(await connect(transport).series()).toEqual([device]);
  expect(transport.urls).toEqual([`${BASE}api/v1/series`]);
});

test("a refused series catalog reports the problem code", async () => {
  const core = connect(scripted(problem(401, "auth.required")));

  expect(await core.series()).toEqual({ problem: "auth.required" });
});

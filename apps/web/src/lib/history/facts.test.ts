import { expect, test } from "bun:test";
import { connect } from "../api/core.ts";
import { dayOf } from "../range/calendar.ts";
import { readFacts } from "./facts.ts";

const ANSWERS = {
  layout: { strings: [{ id: 1, name: "Süd" }] },
  // The core lists registered devices only, never the plant.
  capabilities: { devices: { "1": { series: ["pv.power", "battery.power"] } } },
  records: { years: [{ year: 2026 }, { year: 2025 }] },
  day: {
    points: [{ date: "2025-11-05", start: "2025-11-04T23:00:00Z", end: "2025-11-05T23:00:00Z" }],
  },
  // The first reading came at 07:00 UTC of the first day.
  hour: { points: [{ date: "2025-11-05", start: "2025-11-05T07:00:00Z" }] },
  payback: { investment: 12_000, remaining: 9000, savings: 3000 },
  corrections: { inputs: [] },
  "module-types": { moduleTypes: [{ id: 1, pmax: 400 }] },
};

/** The longest statistics range the core serves (ADR 9): 1,498 days of 23 hours. */
const DAY_SPAN = 1498 * 23 * 3_600_000;

/** The year each statistics read began in. */
const asked: number[] = [];

/** The core answering by the path's last part, statistics by period; a viewer is refused payback. */
function core(viewer = false, rolledUp = true) {
  const answers = new Map<string, object>(Object.entries(ANSWERS));

  if (!rolledUp) answers.set("records", { years: [] });

  return connect({
    base: "http://core.test/",
    fetch: (request) => {
      const url = new URL(request.url);
      const last = url.pathname.split("/").at(-1);
      const key = last === "statistics" ? url.searchParams.get("period") : last;
      const problem = { status: 403, headers: { "content-type": "application/problem+json" } };
      const span =
        Date.parse(url.searchParams.get("to") ?? "") -
        Date.parse(url.searchParams.get("from") ?? "");

      if (last === "statistics" && !(span <= DAY_SPAN))
        return Promise.resolve(
          Response.json({ status: 422, code: "history.range" }, { ...problem, status: 422 }),
        );

      if (last === "statistics")
        asked.push(new Date(url.searchParams.get("from")!).getUTCFullYear());

      return Promise.resolve(
        viewer && key === "payback"
          ? Response.json({ status: 403, code: "auth.forbidden" }, problem)
          : Response.json(answers.get(key ?? "") ?? {}),
      );
    },
  });
}

test("the plant's strings, its battery and EV, its first recorded day and payback", async () => {
  expect(await readFacts(core())).toMatchObject({
    strings: [{ id: 1, name: "Süd" }],
    battery: true,
    ev: false,
    since: dayOf(2025, 10, 5),
    begun: Date.parse("2025-11-05T07:00:00Z"),
    payback: { investment: 12_000, remaining: 9000, savings: 3000 },
    corrections: [],
    peaks: new Map([[1, 400]]),
  });
  // The first day is looked for in the oldest recorded year alone.
  expect(asked).toEqual([2024, 2025]);
});

test("a viewer reads no payback, and a plant without rollups has no first day yet", async () => {
  const facts = await readFacts(core(true, false));

  expect(facts).toMatchObject({ payback: null, since: null, begun: null });
});

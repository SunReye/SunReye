import { expect, test } from "bun:test";
import { connect } from "../api/core.ts";
import { dayOf } from "../range/calendar.ts";
import { readFacts } from "./facts.ts";

const ANSWERS = {
  layout: { strings: [{ id: 1, name: "Süd" }] },
  capabilities: { devices: { "4294967294": { series: ["pv.power", "battery.power"] } } },
  month: { points: [{ date: "2026-11-01", start: "2026-10-31T23:00:00Z" }] },
  day: { points: [{ date: "2026-11-05", start: "2026-11-04T23:00:00Z" }] },
  payback: { investment: 12_000, remaining: 9000, savings: 3000 },
  corrections: { inputs: [] },
  "module-types": { moduleTypes: [{ id: 1, pmax: 400 }] },
};

/** The core answering by the path's last part, statistics by period; a viewer is refused payback. */
function core(viewer = false, rolledUp = true) {
  const answers = new Map<string, object>(Object.entries(ANSWERS));

  if (!rolledUp) answers.set("month", { points: [] });

  return connect({
    base: "http://core.test/",
    fetch: (request) => {
      const url = new URL(request.url);
      const last = url.pathname.split("/").at(-1);
      const key = last === "statistics" ? url.searchParams.get("period") : last;
      const problem = { status: 403, headers: { "content-type": "application/problem+json" } };

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
    since: dayOf(2026, 10, 5),
    payback: { investment: 12_000, remaining: 9000, savings: 3000 },
    corrections: [],
    peaks: new Map([[1, 400]]),
  });
});

test("a viewer reads no payback, and a plant without rollups has no first day yet", async () => {
  const facts = await readFacts(core(true, false));

  expect(facts).toMatchObject({ payback: null, since: null });
});

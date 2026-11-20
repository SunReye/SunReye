import { expect, test } from "bun:test";
import { connect } from "../api/core.ts";
import { eachSeries } from "../api/core.harness.ts";
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

const PROBLEM = { "content-type": "application/problem+json" };

const refusal = (status: number, code: string) =>
  Response.json({ status, code }, { status, headers: PROBLEM });

/** A statistics read: refused past the core's cap, else each series answered by its period. */
function statistics(href: string, answer: (key: string) => object): Response {
  const q = (name: string) => new URL(href).searchParams.get(name) ?? "";
  const span = Date.parse(q("to")) - Date.parse(q("from"));

  if (!(span <= DAY_SPAN)) return refusal(422, "history.range");

  asked.push(new Date(q("from")).getUTCFullYear());

  return eachSeries(href, () => answer(q("period")));
}

/** The core answering by the path's last part, statistics by period; a viewer is refused payback. */
function core(viewer = false, rolledUp = true) {
  const answers = new Map<string, object>(Object.entries(ANSWERS));

  if (!rolledUp) answers.set("records", { years: [] });

  const answer = (key: string) => answers.get(key) ?? {};

  const reads = new Map<string, (href: string) => Response>([
    ["statistics", (href) => statistics(href, answer)],
    ...(viewer ? [["payback", () => refusal(403, "auth.forbidden")] as const] : []),
  ]);

  return connect({
    base: "http://core.test/",
    fetch: (request) => {
      const url = new URL(request.url);
      const last = url.pathname.split("/").at(-1) ?? "";
      const read = reads.get(last) ?? (() => Response.json(answer(last)));

      return Promise.resolve(read(request.url));
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

import { expect, test } from "bun:test";
import { bare, nameFor, opening, queryOf } from "./saved.ts";

const params = (query: string) => new URLSearchParams(query);

test("a view's query is the route's range and view, without the open picker", () => {
  expect(queryOf(params("range=week&at=2026-11-03&mode=fold&by=day&s=1:pv.power&pick=1"))).toBe(
    "at=2026-11-03&by=day&mode=fold&range=week&s=1%3Apv.power",
  );
});

test("two routes that show the same view have one query", () => {
  const plain = queryOf(params(""));

  // Today, the default series and the series mode need no naming.
  expect(queryOf(params("range=day&mode=series&s=4294967294:pv.power,4294967294:load.power"))).toBe(
    plain,
  );
  // A parameter Explore does not know is ignored.
  expect(queryOf(params("later=1"))).toBe(plain);
  expect(queryOf(params("s=1:pv.power&range=week"))).toBe(
    queryOf(params("range=week&s=1:pv.power")),
  );
});

test("routes that show different views differ", () => {
  expect(queryOf(params("s="))).not.toBe(queryOf(params("")));
  expect(queryOf(params("mode=overlay&vs=-1d"))).not.toBe(queryOf(params("mode=overlay&vs=-1w")));
  expect(queryOf(params("range=day&at=2026-11-03"))).not.toBe(queryOf(params("range=day")));
});

test("opening a view sets its parameters and clears every other the route held", () => {
  expect(opening("range=week&s=1:pv.power&later=1")).toEqual({
    range: "week",
    at: null,
    from: null,
    to: null,
    mode: null,
    s: "1:pv.power",
    vs: null,
    by: null,
    pick: null,
  });
});

test("opening a view saved on a day names the day, whatever range the route held", () => {
  expect(opening("s=1:pv.power")).toMatchObject({ range: "day", at: null, from: null, to: null });
});

test("a route is bare while it names nothing of the range or the view", () => {
  expect(bare(params(""))).toBe(true);
  expect(bare(params("later=1"))).toBe(true);
  expect(bare(params("s="))).toBe(false);
  expect(bare(params("range=day"))).toBe(false);
});

test("a view is named after its series' labels, within the core's 256 bytes", () => {
  expect(nameFor(["PV · Leistung", "Haus · Leistung"])).toBe("PV · Leistung, Haus · Leistung");

  const long = nameFor(Array.from({ length: 6 }, () => "Wärmepumpe · Übertemperatur".repeat(3)));

  expect(new TextEncoder().encode(long).length).toBeLessThanOrEqual(256);
  expect(long.startsWith("Wärmepumpe · Übertemperatur")).toBe(true);
  // Cut between characters, never inside one.
  expect(long).not.toContain("�");
});

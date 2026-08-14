import { describe, expect, test } from "bun:test";
import { FLOOR, checkFloor, totalsFromLcov } from "./coverage-floor";

/** A minimal two-record lcov: 8/10 lines, 3/4 functions. */
const lcov = [
  "TN:",
  "SF:apps/server/src/cost.ts",
  "FNF:2",
  "FNH:2",
  "LF:6",
  "LH:5",
  "end_of_record",
  "TN:",
  "SF:apps/web/src/lib/api-payload.ts",
  "FNF:2",
  "FNH:1",
  "LF:4",
  "LH:3",
  "end_of_record",
].join("\n");

describe("totalsFromLcov", () => {
  test("sums LF/LH and FNF/FNH across records", () => {
    expect(totalsFromLcov(lcov)).toEqual({
      linesFound: 10,
      linesHit: 8,
      functionsFound: 4,
      functionsHit: 3,
    });
  });

  test("an empty report totals zero rather than throwing", () => {
    expect(totalsFromLcov("")).toEqual({
      linesFound: 0,
      linesHit: 0,
      functionsFound: 0,
      functionsHit: 0,
    });
  });

  test("ignores lines it does not understand", () => {
    expect(totalsFromLcov("SF:x.ts\nDA:1,1\nBRF:3\nLF:2\nLH:2\nend_of_record")).toMatchObject({
      linesFound: 2,
      linesHit: 2,
    });
  });
});

describe("checkFloor", () => {
  const totals = { linesFound: 100, linesHit: 90, functionsFound: 100, functionsHit: 90 };

  test("above the floor passes and reports the percentages", () => {
    const r = checkFloor(totals, { line: 0.8, function: 0.8 });
    expect(r.ok).toBe(true);
    expect(r.lines).toBeCloseTo(90, 6);
    expect(r.functions).toBeCloseTo(90, 6);
    expect(r.failures).toEqual([]);
  });

  test("exactly at the floor passes — the floor is inclusive", () => {
    expect(checkFloor(totals, { line: 0.9, function: 0.9 }).ok).toBe(true);
  });

  // A dropped test is a regression even when the number barely moves; the whole
  // point of a ratchet is that it does not give ground.
  test("a hair below the floor fails", () => {
    const r = checkFloor(totals, { line: 0.9001, function: 0.9 });
    expect(r.ok).toBe(false);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toContain("line");
  });

  test("both metrics can fail at once", () => {
    expect(checkFloor(totals, { line: 0.95, function: 0.95 }).failures).toHaveLength(2);
  });

  test("an empty report fails rather than passing vacuously", () => {
    // 0 found means the suite never ran, or ran against nothing. Treating that
    // as 100 % would let a broken CI step wave a change through.
    const r = checkFloor(
      { linesFound: 0, linesHit: 0, functionsFound: 0, functionsHit: 0 },
      { line: 0.8, function: 0.8 },
    );
    expect(r.ok).toBe(false);
  });

  // Guards the ratchet against a quiet "just drop it a bit" edit: the floor may
  // only ever be raised, so a change that lowers it below where it started has
  // to break this test first.
  test("the shipped floor never falls below where the ratchet started", () => {
    expect(FLOOR.line).toBeGreaterThanOrEqual(0.79);
    expect(FLOOR.function).toBeGreaterThanOrEqual(0.79);
  });
});

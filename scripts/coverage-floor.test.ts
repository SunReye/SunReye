import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  type FloorIo,
  FLOOR,
  checkFloor,
  main,
  productionIo,
  totalsFromLcov,
} from "./coverage-floor";

/** Capture the two console streams for the duration of `body`, then restore them. */
function captureConsole(body: () => void) {
  const [log, error] = [console.log, console.error];
  const out: string[] = [];
  const err: string[] = [];
  console.log = (m: string) => out.push(m);
  console.error = (m: string) => err.push(m);
  try {
    body();
  } finally {
    console.log = log;
    console.error = error;
  }
  return { out, err };
}

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

  // A counter that is not a number parses to NaN, and every comparison against
  // NaN is false. Read literally that is a pass: the ratchet would wave a change
  // through on a report it could not read. It has to fail instead.
  test("a counter that did not parse fails rather than passing on NaN", () => {
    const r = checkFloor(totalsFromLcov("SF:x.ts\nLF:1e\nLH:2\nFNF:4\nFNH:4\nend_of_record"), {
      line: 0.8,
      function: 0.8,
    });
    expect(r.ok).toBe(false);
    expect(r.failures[0]).toContain("malformed");
  });

  // A counter written with no digits at all reads as zero, which the empty-report
  // rule already catches — it must not read as full coverage either.
  test("a counter with no digits fails as an unrun suite", () => {
    const r = checkFloor(totalsFromLcov("SF:x.ts\nLF:\nLH:\nFNF:\nFNH:\nend_of_record"), {
      line: 0.8,
      function: 0.8,
    });
    expect(r.ok).toBe(false);
    expect(r.failures[0]).toContain("did not run");
  });

  test("a garbled counter on any of the four metrics is malformed", () => {
    for (const record of [
      "LF:ten\nLH:2\nFNF:4\nFNH:4",
      "LF:10\nLH:two\nFNF:4\nFNH:4",
      "LF:10\nLH:2\nFNF:four\nFNH:4",
      "LF:10\nLH:2\nFNF:4\nFNH:four",
    ]) {
      expect(checkFloor(totalsFromLcov(record), { line: 0.1, function: 0.1 }).ok).toBe(false);
    }
  });

  test("a malformed report reports no percentage rather than a NaN one", () => {
    const r = checkFloor(
      { linesFound: Number.NaN, linesHit: 0, functionsFound: 4, functionsHit: 4 },
      { line: 0.8, function: 0.8 },
    );
    expect(r.lines).toBe(0);
    expect(r.functions).toBe(0);
  });

  // 0 lines hit of 100 is a real, readable measurement — the suite ran and
  // covered nothing — not the malformed case.
  test("zero hits of a non-zero total is a breach, not a malformed report", () => {
    const r = checkFloor(
      { linesFound: 100, linesHit: 0, functionsFound: 100, functionsHit: 0 },
      { line: 0.79, function: 0.79 },
    );
    expect(r.ok).toBe(false);
    expect(r.lines).toBe(0);
    expect(r.failures.join("\n")).toContain("0.00 %");
    expect(r.failures.join("\n")).not.toContain("malformed");
  });

  test("functions can be missing while lines are present", () => {
    const r = checkFloor(
      { linesFound: 10, linesHit: 10, functionsFound: 0, functionsHit: 0 },
      { line: 0.8, function: 0.8 },
    );
    expect(r.ok).toBe(false);
    expect(r.failures).toEqual(["empty coverage report — the suite did not run"]);
  });
});

/** An in-memory console + filesystem: `reports` is the only readable path map. */
function fakeIo(reports: Record<string, string>) {
  const out: string[] = [];
  const err: string[] = [];
  const asked: string[] = [];
  const io: FloorIo = {
    readReport: (path) => {
      asked.push(path);
      const report = reports[path];
      if (report === undefined) throw new Error(`ENOENT: ${path}`);
      return report;
    },
    log: (m) => out.push(m),
    error: (m) => err.push(m),
  };
  return { io, out, err, asked, stdout: () => out.join("\n"), stderr: () => err.join("\n") };
}

describe("main", () => {
  test("reads the report the caller names", () => {
    const f = fakeIo({ "build/lcov.info": lcov });
    expect(main(["build/lcov.info"], f.io, { line: 0.5, function: 0.5 })).toBe(0);
    expect(f.asked).toEqual(["build/lcov.info"]);
  });

  // package.json passes the path, the husky hook does not; the default is what
  // the coverage run actually writes.
  test("falls back to the path the coverage run writes", () => {
    const f = fakeIo({ "coverage/lcov.info": lcov });
    expect(main([], f.io, { line: 0.5, function: 0.5 })).toBe(0);
    expect(f.asked).toEqual(["coverage/lcov.info"]);
  });

  test("a report above the floor passes and states both measurements", () => {
    const f = fakeIo({ "coverage/lcov.info": lcov });
    expect(main([], f.io, { line: 0.5, function: 0.5 })).toBe(0);
    expect(f.stdout()).toContain("80.00 % lines");
    expect(f.stdout()).toContain("75.00 % functions");
    expect(f.err).toEqual([]);
  });

  test("a report below the floor fails, naming the breached metric", () => {
    const f = fakeIo({ "coverage/lcov.info": lcov });
    expect(main([], f.io, { line: 0.9, function: 0.5 })).toBe(1);
    expect(f.stderr()).toContain("line coverage 80.00 % is below the floor of 90.00 %");
    expect(f.stderr()).not.toContain("function coverage");
    expect(f.out).toEqual([]);
  });

  // The advice matters as much as the exit code: the one thing a breach must not
  // teach is "lower the floor".
  test("the breach message points at covering the behaviour, not at FLOOR", () => {
    const f = fakeIo({ "coverage/lcov.info": lcov });
    main([], f.io, { line: 0.99, function: 0.99 });
    expect(f.stderr()).toContain("Cover the new behaviour rather than lowering FLOOR");
  });

  // The CI step that runs before this one can fail without failing the job; a
  // missing report is then the only sign, so it may not read as success.
  test("a missing report fails and says which command produces it", () => {
    const f = fakeIo({});
    expect(main(["coverage/lcov.info"], f.io, { line: 0.5, function: 0.5 })).toBe(1);
    expect(f.stderr()).toContain("cannot read coverage/lcov.info");
    expect(f.stderr()).toContain("bun run test:coverage");
  });

  test("an empty report fails rather than reading as 100 %", () => {
    const f = fakeIo({ "coverage/lcov.info": "" });
    expect(main([], f.io, { line: 0.5, function: 0.5 })).toBe(1);
    expect(f.stderr()).toContain("the suite did not run");
  });

  test("a garbled report fails rather than measuring NaN", () => {
    const f = fakeIo({
      "coverage/lcov.info": "TN:\nSF:apps/server/src/cost.ts\nFNF:2\nFNH:2\nLF:?\nLH:1",
    });
    expect(main([], f.io, { line: 0.5, function: 0.5 })).toBe(1);
    expect(f.stderr()).toContain("malformed");
  });

  // Called without a floor — the way the entry point calls it — the shipped
  // FLOOR is what decides, not a permissive default.
  test("the shipped floor is what the entry point checks against", () => {
    const onFloor = Math.ceil(Math.max(FLOOR.line, FLOOR.function) * 100);
    const under = onFloor - 1;
    const report = (hit: number) => `LF:100\nLH:${hit}\nFNF:100\nFNH:${hit}`;
    expect(main([], fakeIo({ "coverage/lcov.info": report(onFloor) }).io)).toBe(0);
    expect(main([], fakeIo({ "coverage/lcov.info": report(under) }).io)).toBe(1);
  });
});

describe("productionIo", () => {
  test("reads the report off disk, and throws when the coverage run left none", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coverage-floor-"));
    try {
      const path = join(dir, "lcov.info");
      await writeFile(path, lcov);
      expect(productionIo.readReport(path)).toBe(lcov);
      expect(() => productionIo.readReport(join(dir, "never-written.info"))).toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // CI reads the two streams apart, and a breach has to survive a piped stdout.
  test("the pass line goes to stdout and a breach to stderr", () => {
    const { out, err } = captureConsole(() => {
      productionIo.log("✓ passed");
      productionIo.error("✖ breached");
    });
    expect(out).toEqual(["✓ passed"]);
    expect(err).toEqual(["✖ breached"]);
  });

  test("called with no wiring at all, a missing report still fails on stderr", () => {
    let code = 0;
    const { out, err } = captureConsole(() => {
      code = main([join(tmpdir(), "sunreye-never-written-lcov.info")]);
    });
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("cannot read");
    expect(out).toEqual([]);
  });
});

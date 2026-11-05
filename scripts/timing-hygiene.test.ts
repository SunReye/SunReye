import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, spyOn, test } from "bun:test";
import {
  type TimingIo,
  type Finding,
  fileIo,
  isTestFile,
  main,
  measure,
  scanFile,
} from "./timing-hygiene";

const rust = (body: string) => scanFile("crates/x/tests/it.rs", body);
const rustInline = (source: string) => scanFile("crates/x/src/lib.rs", source);
const ts = (source: string, file = "a.test.ts") => scanFile(file, source);
const rules = (found: Finding[]) => found.map((f) => f.rule);

describe("isTestFile", () => {
  test.each([
    "crates/sunreye/src/store/tiers.rs",
    "crates/sunreye/tests/cli.rs",
    "crates/sunreye/src/web/tests/ws.rs",
    "crates/sunreye/src/web/tests.rs",
    "apps/web/src/lib/a.test.ts",
    "apps/web/src/lib/a.svelte.test.ts",
    "apps/web/e2e/a.spec.ts",
    "apps/server/db-tests/helpers.ts",
  ])("%s is scanned", (path) => expect(isTestFile(path)).toBe(true));

  test.each([
    "apps/web/src/lib/a.ts",
    "apps/web/e2e/helpers.ts",
    "apps/web/node_modules/x/a.test.ts",
    "crates/target/debug/build/a.rs",
    "docs/a.md",
  ])("%s is not scanned", (path) => expect(isTestFile(path)).toBe(false));
});

describe("Rust: waits", () => {
  test("std::thread::sleep is flagged", () => {
    const found = rust(`#[test]\nfn t() {\n    std::thread::sleep(Duration::from_millis(300));\n}`);
    expect(rules(found)).toEqual(["rust-sleep"]);
    expect(found[0]?.line).toBe(3);
  });

  test("tokio::time::sleep and a bare imported sleep are flagged", () => {
    expect(
      rules(rust(`async fn t() {\n  tokio::time::sleep(Duration::from_millis(1)).await;\n}`)),
    ).toEqual(["rust-sleep"]);
    expect(rules(rust(`async fn t() {\n  sleep(Duration::from_millis(1)).await;\n}`))).toEqual([
      "rust-sleep",
    ]);
    expect(rules(rust(`async fn t() {\n  time::sleep_until(at).await;\n}`))).toEqual([
      "rust-sleep",
    ]);
  });

  test("a method called sleep, or a function defined as one, is not a wait", () => {
    expect(rust(`fn t() {\n  clock.sleep(1);\n}\nfn sleep(x: u8) {}`)).toEqual([]);
  });

  test("paused tokio time passes", () => {
    expect(
      rust(
        `#[tokio::test(start_paused = true)]\nasync fn t() {\n  tokio::time::sleep(Duration::from_secs(60)).await;\n}`,
      ),
    ).toEqual([]);
    expect(
      rust(
        `#[tokio::test]\nasync fn t() {\n  tokio::time::pause();\n  tokio::time::sleep(d).await;\n}`,
      ),
    ).toEqual([]);
  });

  test("a real thread sleep is not made virtual by paused time", () => {
    expect(
      rules(
        rust(`#[tokio::test(start_paused = true)]\nasync fn t() {\n  std::thread::sleep(d);\n}`),
      ),
    ).toEqual(["rust-sleep"]);
  });

  test("pause in one test does not excuse another", () => {
    const source = `#[tokio::test(start_paused = true)]\nasync fn a() {\n  sleep(d).await;\n}\n#[tokio::test]\nasync fn b() {\n  sleep(d).await;\n}`;
    expect(rust(source).map((f) => f.line)).toEqual([7]);
  });

  test("a poll-until-predicate loop with a deadline passes", () => {
    const source = `async fn eventually() {
    let deadline = Instant::now() + Duration::from_secs(20);
    while !ready() {
        assert!(Instant::now() < deadline, "never ready");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}`;
    expect(rust(source)).toEqual([]);
  });

  test("a sleep in a loop that has no bound is still flagged", () => {
    const source = `async fn t() {\n  loop {\n    tokio::time::sleep(d).await;\n  }\n}`;
    expect(rules(rust(source))).toEqual(["rust-sleep"]);
  });

  test("an injected clock passes", () => {
    expect(
      rust(
        `fn t() {\n  let clock = FakeClock::at(0);\n  clock.advance(Duration::from_secs(5));\n  assert_eq!(clock.now(), 5);\n}`,
      ),
    ).toEqual([]);
  });
});

describe("Rust: assertions on elapsed time", () => {
  test("a duration threshold on a measured instant is flagged", () => {
    const source = `fn t() {\n  let started = Instant::now();\n  work();\n  assert!(started.elapsed() < Duration::from_secs(3), "slow");\n}`;
    const found = rust(source);
    expect(rules(found)).toEqual(["rust-elapsed"]);
    expect(found[0]?.line).toBe(4);
  });

  test("the measured value bound to a name first is still flagged", () => {
    const source = `fn t() {\n  let started = std::time::Instant::now();\n  work();\n  let took = started.elapsed();\n  assert!(took < std::time::Duration::from_millis(100), "{took:?}");\n}`;
    expect(rust(source).map((f) => f.line)).toEqual([5]);
  });

  test("a bare Duration threshold is flagged", () => {
    expect(rules(rust(`fn t() {\n  assert!(cost() <= Duration::from_secs(1));\n}`))).toEqual([
      "rust-elapsed",
    ]);
  });

  test("a Duration compared for equality is a value, not a threshold", () => {
    expect(rust(`fn t() {\n  assert_eq!(backoff(3), Duration::from_secs(8));\n}`)).toEqual([]);
  });

  test("a deadline asserted inside a poll loop bounds liveness only", () => {
    const source = `fn t() {\n  let deadline = Instant::now() + Duration::from_secs(5);\n  while !done() {\n    assert!(Instant::now() < deadline, "stuck");\n  }\n}`;
    expect(rust(source)).toEqual([]);
  });

  test("a loop over items is not a poll loop, whatever it times", () => {
    const source = `fn t() {\n  for path in PATHS {\n    let started = Instant::now();\n    get(path);\n    assert!(started.elapsed() < Duration::from_secs(2), "slow");\n  }\n}`;
    expect(rust(source).map((f) => f.line)).toEqual([5]);
  });

  test("measuring without asserting passes", () => {
    expect(
      rust(`fn t() {\n  let started = Instant::now();\n  work();\n  log(started.elapsed());\n}`),
    ).toEqual([]);
  });
});

describe("Rust: test code only", () => {
  test("a #[cfg(test)] module is scanned, the code around it is not", () => {
    const source = `fn run() {\n  std::thread::sleep(d);\n}\n\n#[cfg(test)]\nmod tests {\n  fn t() {\n    std::thread::sleep(d);\n  }\n}\n\nfn after() {\n  std::thread::sleep(d);\n}\n`;
    expect(rustInline(source).map((f) => f.line)).toEqual([8]);
  });

  test("production code outside tests is never flagged", () => {
    expect(rustInline(`async fn run() {\n  tokio::time::sleep(d).await;\n}\n`)).toEqual([]);
  });

  test("a whole file under tests/ is scanned", () => {
    expect(scanFile("crates/x/src/web/tests/ws.rs", `fn t() {\n  sleep(d);\n}`)).toHaveLength(1);
    expect(scanFile("crates/x/src/web/tests.rs", `fn t() {\n  sleep(d);\n}`)).toHaveLength(1);
  });

  test("a comment or a string holding the pattern is not flagged", () => {
    const source = `fn t() {\n  // std::thread::sleep(d);\n  let s = "std::thread::sleep(d)";\n  let r = r#"tokio::time::sleep(d)"#;\n  /* assert!(started.elapsed() < Duration::from_secs(1)); */\n}`;
    expect(rust(source)).toEqual([]);
  });

  test("a brace inside a string does not move the test module's end", () => {
    const source = `#[cfg(test)]\nmod tests {\n  const A: &str = "}";\n  fn t() {\n    std::thread::sleep(d);\n  }\n}\n`;
    expect(rustInline(source)).toHaveLength(1);
  });
});

describe("TypeScript: waits", () => {
  test("Bun.sleep is flagged", () => {
    const found = ts(`test("a", async () => {\n  await Bun.sleep(5);\n});`);
    expect(rules(found)).toEqual(["ts-sleep"]);
    expect(found[0]?.line).toBe(2);
  });

  test("waitForTimeout is flagged", () => {
    const found = ts(`await page.waitForTimeout(500);`, "a.spec.ts");
    expect(rules(found)).toEqual(["ts-wait-for-timeout"]);
  });

  test("a promise that resolves on a setTimeout is flagged", () => {
    expect(rules(ts(`await new Promise((resolve) => setTimeout(resolve, 10));`))).toEqual([
      "ts-sleep",
    ]);
    expect(rules(ts(`const flush = () => new Promise((r) => setTimeout(r, 0));`))).toEqual([
      "ts-sleep",
    ]);
  });

  test("a promise without a timer is not a sleep", () => {
    expect(ts(`await new Promise((resolve) => queueMicrotask(resolve));`)).toEqual([]);
  });

  test("setTimeout outside a promise is not a sleep", () => {
    expect(ts(`test("a", () => {}, 5000);\ntest.setTimeout(360_000);\nsetTimeout(fn, 1);`)).toEqual(
      [],
    );
  });

  test("fake timers pass", () => {
    const source = `vi.useFakeTimers();\ntest("a", async () => {\n  const p = new Promise((r) => setTimeout(r, 1000));\n  vi.advanceTimersByTime(1000);\n  await p;\n});`;
    expect(ts(source)).toEqual([]);
  });

  test("a poll-until-predicate loop with a deadline passes", () => {
    const source = `async function eventually(pred) {
  const deadline = Date.now() + 5000;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error("never");
    await new Promise((r) => setTimeout(r, 10));
  }
}
async function eventuallySleep(pred) {
  const until = performance.now() + 5000;
  while (!pred() && performance.now() < until) await Bun.sleep(10);
}`;
    expect(ts(source)).toEqual([]);
  });

  test("a loop that only counts attempts has no deadline and is still flagged", () => {
    const source = `async function eventually(pred) {\n  for (let i = 0; i < 100 && !pred(); i++) {\n    await Bun.sleep(10);\n  }\n}`;
    expect(ts(source).map((f) => f.line)).toEqual([3]);
  });

  test("a comment or a string holding the pattern is not flagged", () => {
    const source = `// await Bun.sleep(5);\nconst s = "page.waitForTimeout(5)";\nconst t = 'new Promise(r => setTimeout(r, 1))';\nconst u = ${"`"}Bun.sleep(1)${"`"};\n/* page.waitForTimeout(1) */`;
    expect(ts(source)).toEqual([]);
  });

  test("a fixture written inside a template literal is not flagged", () => {
    const fixture = "const src = `\nawait Bun.sleep(5);\n`;";
    expect(ts(fixture)).toEqual([]);
  });
});

describe("TypeScript: assertions on elapsed time", () => {
  test("a performance.now delta in expect is flagged", () => {
    const found = ts(
      `const t0 = performance.now();\nwork();\nexpect(performance.now() - t0).toBeLessThan(100);`,
    );
    expect(rules(found)).toEqual(["ts-elapsed"]);
    expect(found[0]?.line).toBe(3);
  });

  test("a Date.now delta bound to a name first is flagged", () => {
    const source = `const start = Date.now();\nwork();\nconst took = Date.now() - start;\nexpect(took).toBeLessThan(100);`;
    expect(ts(source).map((f) => f.line)).toEqual([4]);
  });

  test("the matcher half of a chained assertion is read", () => {
    const source = `expect(1).toBeLessThan(Date.now() - start);`;
    expect(rules(ts(source))).toEqual(["ts-elapsed"]);
  });

  test("reading the clock without a delta is not a timing assertion", () => {
    expect(ts(`expect(row.at).toBeLessThanOrEqual(Date.now());`)).toEqual([]);
  });

  test("a delta computed but never asserted passes", () => {
    expect(ts(`const t0 = performance.now();\nlog(performance.now() - t0);`)).toEqual([]);
  });

  test("an injected clock passes", () => {
    expect(
      ts(`const clock = fakeClock(0);\nclock.advance(5000);\nexpect(clock.now()).toBe(5000);`),
    ).toEqual([]);
  });
});

describe("measure and the baseline", () => {
  const offender = (line: number): Finding => ({
    file: "a.rs",
    line,
    rule: "rust-sleep",
    replacement: "wait on a channel",
  });
  const found = (...counts: [string, number][]) =>
    counts.flatMap(([file, n]) =>
      Array.from({ length: n }, (_, i) => ({ ...offender(i + 1), file })),
    );

  test("a file within its count passes", () => {
    const result = measure(found(["a.rs", 2]), { "a.rs": 2 });
    expect(result.grown).toEqual([]);
    expect(result.shrunk).toEqual([]);
  });

  test("a file may shrink, and the shrink is reported so the baseline can follow", () => {
    const result = measure(found(["a.rs", 1]), { "a.rs": 3 });
    expect(result.grown).toEqual([]);
    expect(result.shrunk).toEqual([{ file: "a.rs", was: 3, now: 1 }]);
  });

  test("a file that is clean is shrunk to nothing", () => {
    expect(measure([], { "a.rs": 3 }).shrunk).toEqual([{ file: "a.rs", was: 3, now: 0 }]);
  });

  test("a raised count fails with the file's offenders", () => {
    const result = measure(found(["a.rs", 3]), { "a.rs": 2 });
    expect(result.grown).toHaveLength(1);
    expect(result.grown[0]).toMatchObject({ file: "a.rs", allowed: 2 });
    expect(result.grown[0]?.found.map((f) => f.line)).toEqual([1, 2, 3]);
  });

  test("a new offender in an unlisted file fails", () => {
    const result = measure(found(["new.rs", 1]), { "a.rs": 2 });
    expect(result.grown[0]).toMatchObject({ file: "new.rs", allowed: 0 });
  });
});

describe("main", () => {
  const SLEEPS = `fn t() {\n  std::thread::sleep(d);\n  std::thread::sleep(d);\n}`;
  const ONE = `fn t() {\n  std::thread::sleep(d);\n}`;

  function io(files: Record<string, string>, baseline: Record<string, number> | null) {
    const out = { log: [] as string[], error: [] as string[], written: null as unknown };
    const fake: TimingIo = {
      files: async () => Object.keys(files),
      read: async (file) => files[file] ?? "",
      readBaseline: async () => baseline,
      writeBaseline: async (value) => void (out.written = value),
      log: (message) => out.log.push(message),
      error: (message) => out.error.push(message),
    };
    return { fake, out };
  }

  test("a tree within its baseline passes", async () => {
    const { fake, out } = io({ "crates/x/tests/a.rs": SLEEPS }, { "crates/x/tests/a.rs": 2 });
    expect(await main(fake, [])).toBe(0);
    expect(out.error).toEqual([]);
  });

  test("a new offender fails naming file, line and the replacement", async () => {
    const { fake, out } = io({ "crates/x/tests/a.rs": SLEEPS }, {});
    expect(await main(fake, [])).toBe(1);
    const text = out.error.join("\n");
    expect(text).toContain("crates/x/tests/a.rs:2");
    expect(text).toContain("crates/x/tests/a.rs:3");
    expect(text).toContain("channel");
  });

  test("a raised count fails", async () => {
    const { fake } = io({ "crates/x/tests/a.rs": SLEEPS }, { "crates/x/tests/a.rs": 1 });
    expect(await main(fake, [])).toBe(1);
  });

  test("a shrunk file fails until the baseline follows, naming the command", async () => {
    const { fake, out } = io({ "crates/x/tests/a.rs": ONE }, { "crates/x/tests/a.rs": 2 });
    expect(await main(fake, [])).toBe(1);
    expect(out.error.join("\n")).toContain("--write");
  });

  test("files outside the test scope are never read for offenders", async () => {
    const { fake } = io({ "crates/x/src/lib.rs": `fn run() {\n  std::thread::sleep(d);\n}` }, {});
    expect(await main(fake, [])).toBe(0);
  });

  test("--write lowers the baseline to what is left", async () => {
    const { fake, out } = io(
      { "crates/x/tests/a.rs": ONE },
      { "crates/x/tests/a.rs": 2, "gone.rs": 4 },
    );
    expect(await main(fake, ["--write"])).toBe(0);
    expect(out.written).toEqual({ "crates/x/tests/a.rs": 1 });
  });

  test("--write refuses to raise a count or list a new file", async () => {
    const { fake, out } = io({ "crates/x/tests/a.rs": SLEEPS }, { "crates/x/tests/a.rs": 1 });
    expect(await main(fake, ["--write"])).toBe(1);
    expect(out.written).toBeNull();
  });

  test("--write creates the baseline when none exists", async () => {
    const { fake, out } = io(
      { "crates/x/tests/a.rs": SLEEPS, "b.test.ts": "await Bun.sleep(1);" },
      null,
    );
    expect(await main(fake, ["--write"])).toBe(0);
    expect(out.written).toEqual({ "b.test.ts": 1, "crates/x/tests/a.rs": 2 });
  });
});

describe("wiring", () => {
  const scripts = () =>
    JSON.parse(readFileSync("package.json", "utf8")).scripts as Record<string, string>;

  test("test:timing runs the checker", () => {
    expect(scripts()["test:timing"]).toBe("bun scripts/timing-hygiene.ts");
  });

  test("bun run test runs it", () => {
    expect(scripts()["test"]).toContain("bun run test:timing");
  });

  test("scripts/ci runs it in the lint step, before the type check", () => {
    const ci = readFileSync("scripts/ci", "utf8");
    const lint = ci.indexOf('step "lint and format"');
    const run = ci.indexOf("bun run test:timing");
    expect(run).toBeGreaterThan(lint);
    expect(run).toBeLessThan(ci.indexOf("step typecheck"));
  });
});

describe("fileIo", () => {
  const root = join(import.meta.dir, "..");
  const scratch: string[] = [];
  const tmp = async () => {
    const dir = await mkdtemp(join(tmpdir(), "timing-hygiene-"));
    scratch.push(dir);
    return dir;
  };
  afterAll(() => Promise.all(scratch.map((dir) => rm(dir, { recursive: true, force: true }))));

  test("lists this repo's test files and nothing else", async () => {
    const files = await fileIo(root).files();
    expect(files).toContain("scripts/timing-hygiene.test.ts");
    expect(files).toContain("crates/sunreye/tests/cli.rs");
    expect(files).not.toContain("scripts/timing-hygiene.ts");
  });

  test("reads a file relative to the root", async () => {
    expect(await fileIo(root).read("scripts/timing-hygiene.ts")).toContain("Ban tests that wait");
  });

  test("a missing baseline reads as none, and a written one reads back", async () => {
    const path = join(await tmp(), "baseline.json");
    const io = fileIo(root, path);
    expect(await io.readBaseline()).toBeNull();
    await io.writeBaseline({ "a.rs": 2 });
    expect(await io.readBaseline()).toEqual({ "a.rs": 2 });
    expect(await Bun.file(path).text()).toBe('{\n  "a.rs": 2\n}\n');
  });

  test("the pass line goes to stdout and a failure to stderr", () => {
    const out = spyOn(console, "log").mockImplementation(() => {});
    const err = spyOn(console, "error").mockImplementation(() => {});
    fileIo(root).log("fine");
    fileIo(root).error("broken");
    expect([out.mock.calls, err.mock.calls]).toEqual([[["fine"]], [["broken"]]]);
    out.mockRestore();
    err.mockRestore();
  });

  test("the committed baseline holds only files the scan still lists", async () => {
    const io = fileIo(root);
    const listed = new Set(await io.files());
    const baseline = (await io.readBaseline()) ?? {};
    expect(Object.keys(baseline).filter((file) => !listed.has(file))).toEqual([]);
  });
});

describe("an unterminated test module", () => {
  test("is read to the end of the file rather than skipped", () => {
    const source = "#[cfg(test)]\nmod tests {\n  fn t() {\n    std::thread::sleep(d);\n  }\n";
    expect(rustInline(source)).toHaveLength(1);
  });
});

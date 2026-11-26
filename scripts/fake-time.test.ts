import { expect, test } from "bun:test";
import { realTime } from "./fake-time.ts";

const SRC = "apps/home/web/src/";

const found = (path: string, source: string) => realTime(`${SRC}${path}`, source);

/** The calls found in a component test. */
const calls = (source: string) => found("lib/x.svelte.test.ts", source).map((f) => f.call);

test("a real timer in a component test is real time, with its line", () => {
  const source = `import { test } from "vitest";\n\nawait new Promise((done) => setTimeout(done, 50));`;

  expect(found("lib/shell/Shell.svelte.test.ts", source)).toEqual([
    { call: "setTimeout", line: 3 },
  ]);
  expect(found("routes/page.svelte.test.ts", "setInterval(poll, 20);")).toEqual([
    { call: "setInterval", line: 1 },
  ]);
});

test("the clock, a real frame, a sleep and an animation's end are real time", () => {
  expect(calls("const t0 = performance.now();")).toEqual(["performance.now"]);
  expect(calls("requestAnimationFrame(() => done());")).toEqual(["requestAnimationFrame"]);
  expect(calls("await sleep(100);")).toEqual(["sleep"]);
  expect(calls("await animation.finished;")).toEqual(["finished"]);
});

test("a stubbed frame or clock is no real time", () => {
  const source = `vi.stubGlobal("requestAnimationFrame", (f) => frames.push(f));\nvi.spyOn(performance, "now");`;

  expect(found("lib/animate.svelte.test.ts", source)).toEqual([]);
});

test("a file may call what its fake timers fake, and nothing else", () => {
  expect(calls(`vi.useFakeTimers({ toFake: ["setTimeout"] });\nsetTimeout(done, 50);`)).toEqual([]);
  expect(calls(`vi.useFakeTimers({ toFake: ["Date"] });\nsetTimeout(done, 50);`)).toEqual([
    "setTimeout",
  ]);
  expect(
    calls(
      `vi.useFakeTimers({\n  toFake: ["requestAnimationFrame", "performance"],\n});\nperformance.now();`,
    ),
  ).toEqual([]);
  expect(calls(`vi.useFakeTimers();\nsetInterval(poll, 20);`)).toEqual([]);
  expect(calls(`vi.useFakeTimers();\nawait sleep(5);`)).toEqual(["sleep"]);
});

test("harnesses are held to it; sources, unit tests and files outside the SPA are not", () => {
  const source = "setTimeout(done, 16);";

  expect(found("lib/range/drag.harness.ts", source)).toEqual([{ call: "setTimeout", line: 1 }]);
  expect(found("lib/scene/stage.harness.svelte.ts", source)).toEqual([
    { call: "setTimeout", line: 1 },
  ]);
  expect(found("lib/range/Pager.svelte", source)).toEqual([]);
  expect(found("lib/range/range.test.ts", source)).toEqual([]);
  expect(realTime("scripts/x.svelte.test.ts", source)).toEqual([]);
});

test("waiting on an animation's end or a frame it is told on is real time", () => {
  expect(calls("animation.onfinish = () => done();")).toEqual(["onfinish"]);
  expect(calls(`animation.addEventListener("finish", done, { once: true });`)).toEqual([
    "finish event",
  ]);
  expect(calls("const drawn = document.createElement('div').animate([], 0);")).toEqual(["animate"]);
});

test("a finish named for something else is no animation's end", () => {
  expect(calls("await render(Setup, { core, onfinish: () => {} });")).toEqual([]);
  expect(calls("expect(probe.frame().passes).toEqual([]);")).toEqual([]);
  expect(calls(`const keys = ["finish", "start"];`)).toEqual([]);
});

test("a wait's budget is real time, named or not: the config's hang guard is the only one", () => {
  expect(calls("await expect.poll(drawn, { timeout: 15_000 }).toBe(1);")).toEqual(["timeout"]);
  expect(calls("await expect.element(button, { timeout: 2000 }).toBeVisible();")).toEqual([
    "timeout",
  ]);
  expect(calls("await vi.waitFor(drawn, { timeout: 5000 });")).toEqual(["timeout"]);
  expect(
    found(
      "lib/x.svelte.test.ts",
      "const SLOW = { timeout: 15_000 };\n\nawait expect.poll(f, SLOW).toBe(1);",
    ),
  ).toEqual([{ call: "timeout", line: 3 }]);
  expect(calls("await expect.poll(drawn, { timeout: 1000 }).toBe(1);")).toEqual(["timeout"]);
  expect(calls("await expect.element(button, { timeout: 100 }).not.toBeVisible();")).toEqual([
    "timeout",
  ]);
});

test("a wait's budget is found beside other options and as oxfmt lays it out", () => {
  expect(calls("await expect.poll(f, { timeout: 15_000, interval: 50 }).toBe(1);")).toEqual([
    "timeout",
  ]);
  expect(calls("await vi.waitFor(f, { interval: 50, timeout: 5000 });")).toEqual(["timeout"]);
  expect(calls("await expect\n  .poll(f, {\n    timeout: 15_000,\n  })\n  .toBe(1);")).toEqual([
    "timeout",
  ]);
});

test("a wait's budget given by a name or a sum is refused: its length cannot be read", () => {
  expect(calls("await expect.poll(f, { timeout: SLOW_MS }).toBe(1);")).toEqual(["timeout"]);
  expect(calls("await vi.waitFor(f, { timeout: 15 * 1000 });")).toEqual(["timeout"]);
  expect(calls("await vi.waitFor(f, { interval: 50, timeout });")).toEqual(["timeout"]);
  expect(calls(`test("draws", { timeout: MINUTE_MS }, async () => {});`)).toEqual(["test budget"]);
});

test("a budget a file exports is refused where it is given: its uses are in other files", () => {
  expect(found("lib/x.harness.ts", "export const SLOW = { timeout: 15_000 };")).toEqual([
    { call: "timeout", line: 1 },
  ]);
});

test("a wait whose first argument ends in a string is still a wait", () => {
  expect(calls(`await expect.poll(() => x ?? "", { timeout: 9000 }).toBe("a");`)).toEqual([
    "timeout",
  ]);
});

test("a test's own budget is no wait's: it is a raised test budget", () => {
  const budget = ["test budget"];

  expect(calls(`test("draws", { timeout: 60_000 }, async () => {});`)).toEqual(budget);
  expect(calls(`test(\n  "draws",\n  { timeout: 60_000 },\n  async () => {},\n);`)).toEqual(budget);
  expect(
    calls(`const MINUTE = { timeout: 60_000 };\ntest("drags", MINUTE, async () => {});`),
  ).toEqual(budget);
  expect(
    calls(
      `const MINUTE = { timeout: 60_000 };\ntest(\n  "drags",\n  MINUTE,\n  async () => {},\n);`,
    ),
  ).toEqual(budget);
  expect(calls(`test("draws", { timeout: 10_000 }, async () => {});`)).toEqual(budget);
  expect(calls(`test("draws", async () => {\n  await x();\n}, 5000);`)).toEqual(budget);
});

test("a timer after the clock went back to the wall's, in the same block, is real time", () => {
  const source = [
    `test("a", async () => {`,
    `  vi.useFakeTimers();`,
    `  setTimeout(done, 5);`,
    `  vi.useRealTimers();`,
    `  await new Promise((r) => setTimeout(r, 50));`,
    `});`,
    ``,
    `test("b", async () => {`,
    `  realTimers();`,
    `  setInterval(poll, 20);`,
    `});`,
    ``,
    `test("c", () => {`,
    `  setTimeout(done, 5);`,
    `});`,
  ].join("\n");

  expect(found("lib/x.svelte.test.ts", source)).toEqual([
    { call: "setTimeout after real timers", line: 5 },
    { call: "setInterval after real timers", line: 10 },
  ]);
});

test("putting the wall clock back as a test ends is no real time", () => {
  const source = `afterEach(() => {\n  vi.useRealTimers();\n});\n\ntest("a", () => {\n  vi.useFakeTimers();\n  setTimeout(done, 5);\n});`;

  expect(calls(source)).toEqual([]);
});

test("a wait's budget given as vi.waitFor's number is refused", () => {
  expect(calls("await vi.waitFor(() => drawn(), 5000);")).toEqual(["timeout"]);
  expect(calls("await vi.waitFor(() => f(a, b), 15_000);")).toEqual(["timeout"]);
  expect(calls("await vi.waitFor(() => drawn(), 500);")).toEqual(["timeout"]);
});

test("a raised test or hook budget is refused in every file", () => {
  expect(calls("vi.setConfig({ testTimeout: 60_000 });")).toEqual(["test budget"]);
  expect(calls("export default { test: { hookTimeout: 30_000 } };")).toEqual(["test budget"]);
  expect(calls(`test("draws", { timeout: 60_000 }, async () => {});`)).toEqual(["test budget"]);
  expect(calls(`test("draws", async () => {\n  await x();\n}, 90_000);`)).toEqual(["test budget"]);
  expect(
    calls(`const MINUTE = { timeout: 60_000 };\ntest("drags", MINUTE, async () => {});`),
  ).toEqual(["test budget"]);
});

test("an idle callback or a page's timed wait is real time", () => {
  expect(calls("requestIdleCallback(() => done());")).toEqual(["requestIdleCallback"]);
  expect(
    calls(`vi.useFakeTimers({ toFake: ["requestIdleCallback"] });\nrequestIdleCallback(f);`),
  ).toEqual([]);
  expect(calls("await page.waitForTimeout(100);")).toEqual(["waitForTimeout"]);
});

test("a component harness is held to it", () => {
  expect(
    found("lib/range/card.harness.svelte", "<script>\n  setTimeout(done, 16);\n</script>"),
  ).toEqual([{ call: "setTimeout", line: 2 }]);
});

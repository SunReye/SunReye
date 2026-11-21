import { expect, test } from "bun:test";
import { realTime } from "./fake-time.ts";

const SRC = "apps/web/src/";

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

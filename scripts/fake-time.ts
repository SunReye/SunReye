// Component tests run side by side under load, so none may wait on the wall clock or on the
// browser's frames: a file that needs time to pass fakes it (`vi.useFakeTimers`) and advances it,
// and a wait has no budget beyond vitest's own, nor a test beyond its 15 s but in the named slow
// scene files (`SLOW`). A gate step; `bun scripts/fake-time.ts` lists the real-time calls in
// component tests and their harnesses.
//
// It reads source text, a block at a time, so it cannot see: a timer reached through a helper in
// another file, a budget computed at run time, or a wait a library makes on its own clock.

import { Glob } from "bun";

const SRC = "apps/web/src/";

export interface RealTime {
  readonly call: string;
  readonly line: number;
}

interface Call {
  readonly call: string;
  readonly found: RegExp;
  /** What `vi.useFakeTimers` must fake for the call to be fake time; none: always real. */
  readonly faked?: string;
}

const CALLS: readonly Call[] = [
  { call: "setTimeout", found: /\bsetTimeout\(/u, faked: "setTimeout" },
  { call: "setInterval", found: /\bsetInterval\(/u, faked: "setInterval" },
  { call: "performance.now", found: /\bperformance\.now\(/u, faked: "performance" },
  {
    call: "requestAnimationFrame",
    found: /\brequestAnimationFrame\(/u,
    faked: "requestAnimationFrame",
  },
  { call: "sleep", found: /\bsleep\(/u },
  // An animation's end, awaited: it comes when the animation has played out on the wall clock,
  // and is told on the browser's next frame.
  { call: "finished", found: /\.finished\b/u },
  { call: "onfinish", found: /\.onfinish\s*=(?!=)/u },
  { call: "finish event", found: /addEventListener\(\s*["'`]finish["'`]/u },
  // An animation played to wait for its end, or for the frame it ends on.
  { call: "animate", found: /\.animate\(/u },
  {
    call: "requestIdleCallback",
    found: /\brequestIdleCallback\(/u,
    faked: "requestIdleCallback",
  },
  { call: "waitForTimeout", found: /\.waitForTimeout\(/u },
];

/**
 * The serial scene files whose tests need more than vitest's 15 s under software WebGL, by path
 * under `lib/`, with what was measured: they alone may raise a test's budget.
 */
export const SLOW = {
  "builder/lay-modules.svelte.test.ts":
    "Its wiring test took 13.9 s alone and 15.6 s in the full suite: eleven presses and drills through the canvas.",
} satisfies Readonly<Record<string, string>>;

/** Vitest's own budget for a wait (`expect.poll`, `expect.element`, `vi.waitFor`), in ms. */
const WAIT_MS = 1000;

/** Vitest's own budget for a test in the browser, in ms. */
const TEST_MS = 15_000;

/** A `timeout` option, with what it is given when not shorthand. */
const BUDGET = /(?<=[{,]\s*)timeout\s*(?::\s*([^,}\n]+?))?\s*(?=[,}\n])/gu;

/** Whether a budget is above `ms`: one given by a name or a sum cannot be read, so is. */
const over = (given = "", ms = WAIT_MS) =>
  !/^[\d_]+$/u.test(given) || Number(given.replaceAll("_", "")) > ms;

/** A test's call up to its name and the comma after it. */
const TEST_NAMED = /\b(?:test|it)(?:\.\w+)*\(\s*(["'`])(?:\\.|(?!\1)[^\\])*\1\s*,\s*$/u;

/** Whether the text before an argument ends in a test's name: the budget is the test's own. */
const testsOwn = (before: string) => TEST_NAMED.test(before.slice(-500));

const lineAt = (source: string, index: number) => source.slice(0, index).split("\n").length;

/**
 * Where the budget at `at` is given: there, or at each use of the name it is kept under; an
 * exported one also there, as its other uses are in files this one does not show.
 */
function givenAt(source: string, at: number): number[] {
  const [, exported, name] = /(export\s+)?const\s+(\w+)\s*=\s*$/u.exec(source.slice(0, at)) ?? [];

  if (name === undefined) return [at];

  const uses = [...source.slice(at).matchAll(new RegExp(String.raw`\b${name}\b`, "gu"))].map(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a match, only read.
    (use) => at + use.index,
  );

  return exported === undefined ? uses : [at, ...uses];
}

/**
 * Every budget above vitest's given to a wait or a test, inline or by name, with the line it is
 * given on.
 */
function budgets(source: string): RealTime[] {
  return (
    [...source.matchAll(BUDGET)]
      // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a match, only read.
      .flatMap((match) => {
        const at = givenAt(source, source.lastIndexOf("{", match.index));

        return at.map((index) => ({ index, given: match[1] }));
      })
      .flatMap(({ index, given }: Readonly<{ index: number; given: string | undefined }>) => {
        const own = testsOwn(source.slice(0, index));

        if (!over(given, own ? TEST_MS : WAIT_MS)) return [];

        return [{ call: own ? "test budget" : "timeout", line: lineAt(source, index) }];
      })
  );
}

/** Where the call whose `(` is at `open` closes; the source's end if it never does. */
function closing(source: string, open: number): number {
  let depth = 0;

  for (let i = open; i < source.length; i++) {
    const c = source.charAt(i);

    if (c === "(" || c === "{" || c === "[") depth++;

    if (c === ")" || c === "}" || c === "]") depth--;

    if (depth === 0) return i;
  }

  return source.length;
}

/** The last argument of the call whose `(` is at `open`, when it is a number or a bare name. */
function lastArgument(source: string, open: number): string | undefined {
  return /,\s*([\w$]+)\s*,?\s*$/u.exec(source.slice(open + 1, closing(source, open)))?.[1];
}

/** A test's budget as its last argument, and `vi.waitFor`'s as a number. */
function trailing(source: string): RealTime[] {
  const calls = [
    ...source.matchAll(/\b(?:test|it)(?:\.\w+)*(\()\s*["'`]/gu),
    ...source.matchAll(/\bvi\.waitFor(\()/gu),
  ];

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a match, only read.
  return calls.flatMap((call) => {
    const open = call.index + call[0].indexOf("(");
    const given = lastArgument(source, open);
    const waits = call[0].startsWith("vi.");

    if (given === undefined || (waits && !/^[\d_]+$/u.test(given))) return [];

    // A test's last argument is its body unless it is a budget.
    if (!waits && !/^(?:[\d_]+|[A-Z][\w$]*)$/u.test(given)) return [];

    if (!over(given, waits ? WAIT_MS : TEST_MS)) return [];

    const line = lineAt(source, closing(source, open));

    return [{ call: waits ? "timeout" : "test budget", line }];
  });
}

/** A raised budget for every test or hook of the file, or of a project. */
function raised(source: string): RealTime[] {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a match, only read.
  return [...source.matchAll(/\b(?:testTimeout|hookTimeout)\s*:/gu)].map((match) => ({
    call: "test budget",
    line: lineAt(source, match.index),
  }));
}

/** A top-level block: a test, a hook or a suite. */
const BLOCK = /^(?:test|it|describe|beforeEach|afterEach|beforeAll|afterAll)\b/gmu;

/** A timer set after the clock went back to the wall's, in the same block. */
function afterReal(source: string): RealTime[] {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a match, only read.
  const starts = [...source.matchAll(BLOCK)].map((block) => block.index);

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a match, only read.
  return [...source.matchAll(/\b(?:vi\.useRealTimers|realTimers)\(\)/gu)].flatMap((back) => {
    const end = starts.find((at) => at > back.index) ?? source.length;
    const rest = source.slice(back.index, end);

    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a match, only read.
    return [...rest.matchAll(/\b(setTimeout|setInterval)\(/gu)].map((timer) => ({
      call: `${timer[1] ?? ""} after real timers`,
      line: lineAt(source, back.index + timer.index),
    }));
  });
}

/** What the file's fake timers fake; `undefined` when one call fakes them all. */
function fakes(source: string): Set<string> | undefined {
  const faked = new Set<string>();

  for (const [, options] of source.matchAll(/vi\.useFakeTimers\(([^)]*)\)/gu)) {
    const list = /toFake:\s*\[([^\]]*)\]/u.exec(options ?? "");

    if (!list) return undefined;

    for (const [, name] of (list[1] ?? "").matchAll(/"(\w+)"/gu)) faked.add(name ?? "");
  }

  return faked;
}

/** Whether the rule holds for this file: a component test of the SPA or a harness for one. */
function covered(path: string): boolean {
  return path.startsWith(SRC) && /\.svelte\.test\.ts$|\.harness(?:\.svelte)?(?:\.ts)?$/u.test(path);
}

/** Every real-time call in one file that does not fake its timers. */
export function realTime(path: string, source: string): RealTime[] {
  if (!covered(path)) return [];

  const faked = fakes(source);

  const real = CALLS.filter(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a call's pattern is only read.
    ({ faked: by }) => by === undefined || (faked !== undefined && !faked.has(by)),
  );

  const calls = source.split("\n").flatMap((text, index) =>
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a call's pattern is only read.
    real.flatMap(({ call, found }) => (found.test(text) ? [{ call, line: index + 1 }] : [])),
  );

  const slow = Object.hasOwn(SLOW, path.slice(`${SRC}lib/`.length));

  const all = [...calls, ...budgets(source), ...trailing(source), ...raised(source)].filter(
    (found) => !(slow && found.call === "test budget"),
  );

  return [...all, ...afterReal(source)].toSorted((a, b) => a.line - b.line);
}

if (import.meta.main) {
  const root = new URL("..", import.meta.url).pathname;

  const paths = [
    ...new Glob(`${SRC}**/*.{svelte.test.ts,harness.ts,harness.svelte.ts,harness.svelte}`).scanSync(
      root,
    ),
  ].toSorted();

  const sources = await Promise.all(paths.map((path) => Bun.file(`${root}${path}`).text()));

  const findings = paths.flatMap((path, index) =>
    realTime(path, sources[index] ?? "").map((found) => `${path}:${found.line} ${found.call}`),
  );

  for (const finding of findings) process.stderr.write(`${finding}\n`);

  if (findings.length > 0) {
    process.stderr.write(
      `\n${findings.length} real-time calls in component tests: fake the timers and advance them.\n`,
    );
    process.exitCode = 1;
  }
}

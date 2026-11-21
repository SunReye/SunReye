// Component tests run side by side under load, so none may wait on the wall clock: a file that
// needs time to pass fakes it (`vi.useFakeTimers`) and advances it. A gate step;
// `bun scripts/fake-time.ts` lists the real-time calls in component tests and their harnesses.

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
  // An animation's end, awaited: it comes when the animation has played out on the wall clock.
  { call: "finished", found: /\.finished\b/u },
];

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
  return path.startsWith(SRC) && /\.svelte\.test\.ts$|\.harness(?:\.svelte)?\.ts$/u.test(path);
}

/** Every real-time call in one file that does not fake its timers. */
export function realTime(path: string, source: string): RealTime[] {
  if (!covered(path)) return [];

  const faked = fakes(source);

  const real = CALLS.filter(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a call's pattern is only read.
    ({ faked: by }) => by === undefined || (faked !== undefined && !faked.has(by)),
  );

  return source.split("\n").flatMap((text, index) =>
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a call's pattern is only read.
    real.flatMap(({ call, found }) => (found.test(text) ? [{ call, line: index + 1 }] : [])),
  );
}

if (import.meta.main) {
  const root = new URL("..", import.meta.url).pathname;

  const paths = [
    ...new Glob(`${SRC}**/*.{svelte.test,harness,harness.svelte}.ts`).scanSync(root),
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

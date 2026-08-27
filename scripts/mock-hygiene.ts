#!/usr/bin/env bun
/**
 * Guard against `mock.module` mocks of our own modules that leak: the partial
 * ones, which delete exports for everyone downstream, and the permanent ones,
 * which stay installed for everyone downstream.
 *
 * bun runs every test file in ONE process, and `mock.module` is global and
 * permanent: the mock a file registers is live for every file that runs after
 * it. So a factory returning only the exports its own suite needs DELETES the
 * rest for everyone downstream. The next file whose import chain needs a deleted
 * export dies at load — "Export named 'getInverterConfig' not found in module
 * config.ts" — and, because it never finishes loading, its own mock
 * registrations never happen either, so unrelated suites fail with unrelated
 * errors.
 *
 * That is not hypothetical: it is what made `initProfiles` and the `computeCost`
 * live-register tests fail. Worse, it depends on the order the runner walks the
 * files, so the suite passed on one machine and failed on another — the failure
 * named none of the guilty code.
 *
 * The fix is always the same, so the rule is mechanical: spread the real module,
 * override only what you stub.
 *
 *   const real = await import("./config");
 *   mock.module("./config", () => ({ ...real, getMqttConfig: stub }));
 *
 * The second rule covers what the first one does not. A spread mock is still
 * PERMANENT: the stubbed export stays installed for every file that loads after
 * this one, and when a later suite is the one that unit-tests that very module,
 * it imports the stub instead of the real implementation and asserts against a
 * double. That fired here too — `spot-price-job.test.ts` stubs
 * `@SunReye/db/spot-price`, and `packages/db/src/spot-price.test.ts` went
 * 22-tests-red in the full suite ("no query was issued") while passing alone. So
 * a first-party mock must also be handed back:
 *
 *   const realDb = await import("@SunReye/db/spot-price");
 *   const realDbExports = { ...realDb };   // by value, at load time
 *
 *   mock.module("@SunReye/db/spot-price", () => ({ ...realDb, getSpotPrices: stub }));
 *
 *   afterAll(() => {
 *     mock.module("@SunReye/db/spot-price", () => ({ ...realDbExports }));
 *   });
 *
 * The snapshot is load-bearing: a module namespace is live, so once the mock is
 * installed `realDb.getSpotPrices` IS the stub and `() => realDb` restores the
 * stub.
 *
 * Which is the third rule, and the reason it exists as a check of its own: that
 * mistake passes both of the others. The factory spreads, and the specifier IS
 * handed back in an `afterAll` — so a teardown that returns `{ ...realDb }`
 * re-registers the very double it was written to remove, and the suite stays red
 * in the full run and green alone with every gate reporting clean. A restore is
 * therefore only a restore if what it spreads was snapshotted by value; spreading
 * a binding held straight to `await import(...)` is flagged.
 *
 * Third-party modules are exempt from both rules: stubbing `mqtt` wholesale is
 * the point, there is no in-repo import chain to break, and no suite in this repo
 * unit-tests it.
 *
 * Usage: `bun scripts/mock-hygiene.ts`.
 */

import { Glob } from "bun";

const ROOTS = ["apps", "packages", "scripts"];

/** `mock.module("<specifier>", ...` — tolerant of spacing and quote style. */
const MOCK_CALL = /\bmock\s*\.\s*module\s*\(\s*['"]([^'"]+)['"]\s*,/g;

/**
 * `afterAll(` — a call, not the mere word: a comment promising a restore, or a
 * variable named after one, installs no teardown. Only `afterAll` counts, not
 * `afterEach`: restoring between tests would hand the module back while the rest
 * of this file's own suite still depends on the stub.
 */
const AFTER_ALL_CALL = /\bafterAll\s*\(/g;

/** Whether a specifier names something in this repo rather than a dependency. */
function isWorkspaceModule(specifier: string): boolean {
  return specifier.startsWith(".") || specifier.startsWith("@SunReye/");
}

/**
 * Escape hatch, for the case the rule genuinely cannot cover: importing the real
 * module runs the initialization the suite mocks it to avoid (`@SunReye/auth`
 * boots Better Auth, which wants env and a database). A reason is mandatory —
 * without one this is just a way to silence the check.
 */
const SUPPRESSION = /mock-hygiene-ignore-next-line\s*--\s*\S/;

export type Violation = { file: string; line: number; specifier: string };

/** A `mock.module` call of a first-party module: where it is, and its text. */
type MockCall = { specifier: string; line: number; body: string };

/**
 * Every `mock.module` call in `region` that any of the rules could care about:
 * first-party specifier, not suppressed. This is the whole shared preamble, so
 * each rule below is left holding only its own question.
 *
 * `region` is the text being walked and `offset` where that text begins in
 * `source`: the two rules that judge installs walk the file, the one that judges
 * restores walks a single teardown. Lines and suppressions are read off `source`
 * either way — so a violation inside a teardown is reported at its true line,
 * and the comment above it is found even though it sits outside the region.
 *
 * The body runs from the call to its matching close paren, so a multi-line
 * factory is read whole.
 */
function firstPartyMocks(source: string, region: string = source, offset = 0): MockCall[] {
  const calls: MockCall[] = [];
  for (const match of region.matchAll(MOCK_CALL)) {
    const specifier = match[1] as string;
    const before = source.slice(0, offset + match.index);
    const suppressed = SUPPRESSION.test(before.split("\n").at(-2) ?? "");

    if (!isWorkspaceModule(specifier) || suppressed) continue;

    calls.push({ specifier, line: before.split("\n").length, body: callBody(region, match.index) });
  }
  return calls;
}

/**
 * The calls turned into violations, naming each specifier once — the first
 * mention wins, since one fix discharges however many call sites share it.
 */
function oncePerSpecifier(calls: MockCall[], file: string): Violation[] {
  const found: Violation[] = [];
  const named = new Set<string>();
  for (const { specifier, line } of calls) {
    if (named.has(specifier)) continue;
    named.add(specifier);
    found.push({ file, line, specifier });
  }
  return found;
}

/** Every specifier handed to `mock.module` in `text`, whatever it names. */
function mockedSpecifiers(text: string): string[] {
  return [...text.matchAll(MOCK_CALL)].map((match) => match[1] as string);
}

/**
 * Every workspace-module mock in `source` whose factory body has no spread.
 *
 * Any spread counts — insisting it be the first property would reject legitimate
 * orderings, and the failure mode of being lenient is a missed warning rather
 * than a blocked change. Every call site is reported, not one per specifier: a
 * partial factory is a defect wherever it is written.
 */
export function violations(source: string, file: string): Violation[] {
  return firstPartyMocks(source)
    .filter((call) => !call.body.includes("..."))
    .map(({ specifier, line }) => ({ file, line, specifier }));
}

/**
 * Every first-party module `source` stubs and never hands back.
 *
 * A restore is an `afterAll` that calls `mock.module` again with the SAME
 * specifier — matched by specifier, since a file's unrelated teardown proves
 * nothing about the module it leaked. Position does not matter beyond that, and
 * the specifiers must match as written: two spellings of one path read as two
 * modules here, which fails towards a false block that is fixed by writing the
 * same string twice.
 *
 * A specifier is named once however many times it was installed — one restore
 * discharges the lot — and the mock calls inside the teardown are the restore, so
 * they carry no obligation of their own.
 */
export function unrestored(source: string, file: string): Violation[] {
  const restored = new Set(afterAllBodies(source).flatMap(mockedSpecifiers));
  const leaked = firstPartyMocks(source).filter((call) => !restored.has(call.specifier));
  return oncePerSpecifier(leaked, file);
}

/**
 * `const realDb = await import("...")` — a binding held straight to a module
 * NAMESPACE, which is live. Only a plain identifier counts: `const { log } =
 * await import(...)` destructures a value out at that moment and binds no
 * namespace, and `const realX = { ...(await import(...)) }` is already the
 * by-value snapshot this rule asks for.
 */
const NAMESPACE_BINDING = /\b(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*await\s+import\s*\(/g;

/** `...someIdentifier` inside a factory body. */
const SPREAD = /\.\.\.\s*([A-Za-z0-9_$]+)/g;

/** Whether a factory body hands back one of the live namespaces of this file. */
function spreadsNamespace(body: string, namespaces: Set<string>): boolean {
  return [...body.matchAll(SPREAD)].some((match) => namespaces.has(match[1] as string));
}

/**
 * Every first-party module `source` "restores" by handing back a live namespace,
 * which restores nothing.
 *
 * This is the trap inside the fix for `unrestored`, and neither of the other two
 * checks can see it: the mock spreads, and the module *is* handed back in an
 * `afterAll`, so both pass. But a module namespace is live. Once the mock is
 * installed, `realDb.getSpotPrices` IS the stub — so a teardown spreading
 * `realDb` re-registers the double it was meant to remove, and the leak survives
 * with every gate green. The restore has to spread a snapshot taken BY VALUE at
 * load time, before any mock was installed.
 *
 * Only teardown bodies are judged: the install is supposed to spread the live
 * namespace, since that is what keeps the untouched exports alive.
 */
export function liveRestores(source: string, file: string): Violation[] {
  const namespaces = new Set(
    [...source.matchAll(NAMESPACE_BINDING)].map((match) => match[1] as string),
  );
  const restores = afterAllCalls(source).flatMap(({ body, offset }) =>
    firstPartyMocks(source, body, offset),
  );
  return oncePerSpecifier(
    restores.filter((call) => spreadsNamespace(call.body, namespaces)),
    file,
  );
}

/**
 * Every `afterAll(...)` call, each with the offset its body starts at in
 * `source`, so a violation inside one can be reported at its true line.
 */
function afterAllCalls(source: string): { body: string; offset: number }[] {
  const calls: { body: string; offset: number }[] = [];
  for (const match of source.matchAll(AFTER_ALL_CALL)) {
    const offset = source.indexOf("(", match.index);
    if (offset === -1) continue;
    const body = callBody(source, match.index);
    if (body !== "") calls.push({ body, offset });
  }
  return calls;
}

/**
 * The text of every `afterAll(...)` call in `source`, each from its opening paren
 * to the matching close, so a multi-line teardown is read whole.
 */
export function afterAllBodies(source: string): string[] {
  return afterAllCalls(source).map((call) => call.body);
}

/**
 * The text of the call that starts at or after `from`, from its opening paren to
 * the matching close — so nested parens inside the factory (there are always
 * some: it is an arrow function) do not end the body early.
 */
export function callBody(source: string, from: number): string {
  const start = source.indexOf("(", from);
  if (start === -1) return "";
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")" && --depth === 0) return source.slice(start, i + 1);
  }
  return source.slice(start); // unbalanced source: treat the rest as the body
}

/**
 * This checker's own suite, whose fixtures are `mock.module(...)` written out as
 * strings. Scanning it would report the examples it exists to describe.
 */
const SELF = "scripts/mock-hygiene.test.ts";

/**
 * Every colocated test file, sorted, excluding build output and dependencies.
 * `cwd` is what the returned paths are relative to — the repo root in production.
 */
export async function testFiles(roots: string[] = ROOTS, cwd?: string): Promise<string[]> {
  const found: string[] = [];
  for (const root of roots) {
    for await (const file of new Glob(`${root}/**/*.test.ts`).scan({ dot: false, cwd })) {
      if (file.includes("node_modules") || file.includes("/dist/") || file === SELF) continue;
      found.push(file);
    }
  }
  return found.sort();
}

/**
 * Everything the CLI reaches the outside world through: the file walk, the reads
 * and the two console streams. Injected — production wiring is the default, so
 * the entry point passes nothing — so the reporting can be proven against a
 * known set of files instead of whatever the repo happens to contain today.
 */
export interface HygieneIo {
  testFiles(): Promise<string[]>;
  read(file: string): Promise<string>;
  log(message: string): void;
  error(message: string): void;
}

/** The real wiring: the repo walk, the filesystem, and the two console streams. */
export const productionIo: HygieneIo = {
  testFiles: () => testFiles(),
  read: (file) => Bun.file(file).text(),
  log: (message) => console.log(message),
  error: (message) => console.error(message),
};

/**
 * The by-value snapshot both leak messages open their fix with, and the teardown
 * both of them close it with — written once, because the two rules are two
 * halves of the same mistake and their advice must not drift apart.
 */
const SNAPSHOT_EXAMPLE = [
  '    const realDb = await import("@SunReye/db/spot-price");',
  "    const realDbExports = { ...realDb };   // by value, before any mock",
  "",
];

const RESTORE_EXAMPLE = [
  "    afterAll(() => {",
  '      mock.module("@SunReye/db/spot-price", () => ({ ...realDbExports }));',
  "    });",
  "",
];

/** One rule's section of the failure: what it found, and how to make it go away. */
type Report = { found: Violation[]; heading: string; explanation: string[] };

const PARTIAL_MESSAGE = {
  heading: "✖ Partial mock of a workspace module:",
  explanation: [
    "  mock.module is process-global and permanent, so a factory returning only",
    "  the exports this suite needs deletes the rest for every test file that",
    "  runs after it — breaking them at import, in an order-dependent way.",
    "",
    "  Spread the real module and override just what you stub:",
    "",
    '    const real = await import("./config");',
    '    mock.module("./config", () => ({ ...real, getMqttConfig: stub }));',
    "",
  ],
};

const LEAK_MESSAGE = {
  heading: "✖ Workspace-module mock that is never handed back:",
  explanation: [
    "  A spread keeps the other exports alive, but the stub itself is permanent:",
    "  it stays installed for every test file that loads after this one. When a",
    "  later suite is the one that unit-tests that module, it silently imports",
    "  this double instead of the real implementation and asserts against it —",
    "  red in the full run, green on its own, and naming none of the guilty code.",
    "",
    "  Snapshot the real exports BY VALUE at load time, then hand them back:",
    "",
    ...SNAPSHOT_EXAMPLE,
    '    mock.module("@SunReye/db/spot-price", () => ({ ...realDb, getSpotPrices: stub }));',
    "",
    ...RESTORE_EXAMPLE,
    "  The snapshot is the whole trick: a module namespace is live, so once the",
    "  mock is installed `realDb.getSpotPrices` IS the stub — which is why",
    "  `() => realDb` restores the stub and does nothing at all.",
    "",
  ],
};

const STALE_MESSAGE = {
  heading: "✖ Restore that hands back the live namespace, so it restores the stub:",
  explanation: [
    "  This teardown looks like a restore and is not one. A module namespace is",
    "  live: by the time the teardown runs, the mock is installed, so the export",
    "  read off the namespace IS the stub — handing it back re-registers the",
    "  double. The leak survives with every check green, which is worse than no",
    "  restore at all, because the file now reads as if it had one.",
    "",
    "  Snapshot BY VALUE at load time, before any mock, and hand THAT back:",
    "",
    ...SNAPSHOT_EXAMPLE,
    ...RESTORE_EXAMPLE,
  ],
};

/** The heading, the offending call sites, then the fix. */
function printReport(io: HygieneIo, { found, heading, explanation }: Report): void {
  io.error("");
  io.error(heading);
  io.error("");
  for (const v of found) io.error(`  • ${v.file}:${v.line} — mock.module("${v.specifier}")`);
  io.error("");
  for (const line of explanation) io.error(line);
}

/** The check: scan every test file, report every kind of leak, return the exit code. */
export async function main(io: HygieneIo = productionIo): Promise<number> {
  const partial: Violation[] = [];
  const leaked: Violation[] = [];
  const stale: Violation[] = [];
  for (const file of await io.testFiles()) {
    const source = await io.read(file);
    partial.push(...violations(source, file));
    leaked.push(...unrestored(source, file));
    stale.push(...liveRestores(source, file));
  }

  const reports: Report[] = [
    { found: partial, ...PARTIAL_MESSAGE },
    { found: leaked, ...LEAK_MESSAGE },
    { found: stale, ...STALE_MESSAGE },
  ].filter((report) => report.found.length > 0);

  if (reports.length === 0) {
    io.log(
      "✓ Mock hygiene: every workspace-module mock spreads the real module, and hands it back by value.",
    );
    return 0;
  }

  for (const report of reports) printReport(io, report);
  return 1;
}

if (import.meta.main) process.exit(await main());

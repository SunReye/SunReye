#!/usr/bin/env bun
/**
 * Guard against partial `mock.module` mocks of our own modules.
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
 * Third-party modules are exempt: stubbing `mqtt` wholesale is the point, and
 * there is no in-repo import chain to break.
 *
 * Usage: `bun scripts/mock-hygiene.ts`.
 */

import { Glob } from "bun";

const ROOTS = ["apps", "packages", "scripts"];

/** `mock.module("<specifier>", ...` — tolerant of spacing and quote style. */
const MOCK_CALL = /\bmock\s*\.\s*module\s*\(\s*['"]([^'"]+)['"]\s*,/g;

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

/**
 * Every workspace-module mock in `source` whose factory body has no spread.
 *
 * The body is taken from the mock call to its matching close paren, so a
 * multi-line factory is read whole. Any spread counts — insisting it be the
 * first property would reject legitimate orderings, and the failure mode of
 * being lenient is a missed warning rather than a blocked change.
 */
export function violations(source: string, file: string): Violation[] {
  const found: Violation[] = [];
  for (const match of source.matchAll(MOCK_CALL)) {
    const specifier = match[1] as string;
    const before = source.slice(0, match.index);
    const suppressed = SUPPRESSION.test(before.split("\n").at(-2) ?? "");

    if (!isWorkspaceModule(specifier) || suppressed) continue;
    if (callBody(source, match.index).includes("...")) continue;

    found.push({ file, line: before.split("\n").length, specifier });
  }
  return found;
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

/** Every colocated test file, sorted, excluding build output and dependencies. */
export async function testFiles(roots: string[] = ROOTS): Promise<string[]> {
  const found: string[] = [];
  for (const root of roots) {
    for await (const file of new Glob(`${root}/**/*.test.ts`).scan({ dot: false })) {
      if (file.includes("node_modules") || file.includes("/dist/") || file === SELF) continue;
      found.push(file);
    }
  }
  return found.sort();
}

if (import.meta.main) {
  const found: Violation[] = [];
  for (const file of await testFiles()) {
    found.push(...violations(await Bun.file(file).text(), file));
  }

  if (found.length === 0) {
    console.log("✓ Mock hygiene: every workspace-module mock spreads the real module.");
    process.exit(0);
  }

  console.error("");
  console.error("✖ Partial mock of a workspace module:");
  console.error("");
  for (const v of found) console.error(`  • ${v.file}:${v.line} — mock.module("${v.specifier}")`);
  console.error("");
  console.error("  mock.module is process-global and permanent, so a factory returning only");
  console.error("  the exports this suite needs deletes the rest for every test file that");
  console.error("  runs after it — breaking them at import, in an order-dependent way.");
  console.error("");
  console.error("  Spread the real module and override just what you stub:");
  console.error("");
  console.error('    const real = await import("./config");');
  console.error('    mock.module("./config", () => ({ ...real, getMqttConfig: stub }));');
  console.error("");
  process.exit(1);
}

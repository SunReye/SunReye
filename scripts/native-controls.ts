// The kit is the only source of controls (ADR 11): no Svelte file of the SPA outside
// `components/ui` may hold a native <select>, <table>, bare <button>, or an <input> of a type the
// kit has a control for. A gate step; `bun scripts/native-controls.ts` lists the findings.

import { Glob } from "bun";

const ROOT = "apps/web/src/";

const KIT = "apps/web/src/lib/components/ui/";

const BANNED_INPUTS = new Set(["date", "time", "datetime-local", "range", "color", "file"]);

export interface Finding {
  readonly element: string;
  readonly line: number;
}

/** Whether the rule holds for this file: a Svelte file of the SPA outside the kit. */
export function covered(path: string): boolean {
  return path.startsWith(ROOT) && path.endsWith(".svelte") && !path.startsWith(KIT);
}

/** The markup alone: scripts, styles and comments blanked, every line kept. */
function markup(source: string): string {
  return source.replaceAll(
    /<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<!--[\s\S]*?-->/gu,
    (block) => block.replaceAll(/[^\n]/gu, " "),
  );
}

/**
 * An opening tag of a control, whole: up to its first `>` outside a quoted value and outside an
 * expression, whose braces may nest three deep (an arrow function with an object in a call).
 */
const TAG =
  /<(select|table|button|input)(?=[\s/>])(?:"[^"]*"|'[^']*'|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}|[^>"'{])*>/gu;

/** What a tag is called in a finding, or undefined when the kit has no say over it. */
function banned(name: string, tag: string): string | undefined {
  if (name !== "input") return name;

  const type = /\stype="([^"]*)"/u.exec(tag)?.[1] ?? "";

  return BANNED_INPUTS.has(type) ? `input type="${type}"` : undefined;
}

/** Every native control in a Svelte source that the kit replaces. */
export function nativeControls(source: string): Finding[] {
  const text = markup(source);

  const found: Finding[] = [];

  for (const match of text.matchAll(TAG)) {
    const element = banned(match[1] ?? "", match[0]);

    if (element !== undefined) {
      found.push({ element, line: text.slice(0, match.index).split("\n").length });
    }
  }

  return found;
}

if (import.meta.main) {
  const root = new URL("..", import.meta.url).pathname;
  const paths = [...new Glob(`${ROOT}**/*.svelte`).scanSync(root)].toSorted();

  const held = paths.filter((path) => covered(path));

  const sources = await Promise.all(held.map((path) => Bun.file(`${root}${path}`).text()));

  const findings = held.flatMap((path, index) =>
    nativeControls(sources[index] ?? "").map(
      (found) => `${path}:${found.line} native <${found.element}>`,
    ),
  );

  for (const finding of findings) process.stderr.write(`${finding}\n`);

  if (findings.length > 0) {
    process.stderr.write(
      `\n${findings.length} native controls outside components/ui: use the kit (ADR 11).\n`,
    );
    process.exitCode = 1;
  }
}

#!/usr/bin/env bun
// The profile author's CLI (ADR 5, 8): thin TypeScript over the profile WASM.

import { readFile } from "node:fs/promises";
import { buildProfiles, renderedAt } from "./build.ts";
import { loadProfileWasm } from "./profile-wasm.ts";

const usage = `usage: sunreye-profile <command>
  lint <profile>          the loader's warnings for a profile module or file
  decode <profile> <dump> each quantity's value from a register dump, [{ "start", "words" }]
  build <dir>             renders each profile module in <dir> to <id>.json and index.json,
                          bumping a profile's patch version when its content changed
`;

async function lint(path: string): Promise<string> {
  const wasm = await loadProfileWasm();

  return wasm
    .lint(await renderedAt(path))
    .map((warning) => `warning: ${warning}\n`)
    .join("");
}

async function decode(path: string, dump: string): Promise<string> {
  const wasm = await loadProfileWasm();
  const values = wasm.decode(await renderedAt(path), await readFile(dump, "utf8"));

  return `${JSON.stringify(values, undefined, 2)}\n`;
}

async function build(dir: string): Promise<string> {
  const built = await buildProfiles(dir, dir);

  return built
    .map(({ id, version, warnings }) =>
      [`${id} ${version}\n`, ...warnings.map((warning) => `  warning: ${warning}\n`)].join(""),
    )
    .join("");
}

/** Each command and the arguments it takes. */
const commands = new Map<string, (args: readonly string[]) => Promise<string> | undefined>([
  ["lint", ([path]) => (path === undefined ? undefined : lint(path))],
  [
    "decode",
    ([path, dump]) => (path === undefined || dump === undefined ? undefined : decode(path, dump)),
  ],
  ["build", ([dir]) => (dir === undefined ? undefined : build(dir))],
]);

/** What a run of the CLI wrote, and its exit code. */
export interface Ran {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

async function report(output: Readonly<Promise<string>>): Promise<Ran> {
  try {
    return { code: 0, out: await output, err: "" };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    return { code: 1, out: "", err: `error: ${reason}\n` };
  }
}

/** Runs one command: 0 on success, 1 with the reason it failed, 2 with the usage. */
export function run([command = "", ...args]: readonly string[]): Promise<Ran> {
  const output = commands.get(command)?.(args);

  return output === undefined ? Promise.resolve({ code: 2, out: "", err: usage }) : report(output);
}

if (import.meta.main) {
  const { code, out, err } = await run(process.argv.slice(2));

  process.stdout.write(out);
  process.stderr.write(err);
  process.exitCode = code;
}

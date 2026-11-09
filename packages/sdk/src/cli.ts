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
  capture <endpoint> <unit> <profile>
                          a read-only capture of a device for sim, from the core's
                          \`sunreye capture\`: <endpoint> is modbus-tcp://,
                          rtu-over-tcp:// or solarman-v5://host:port, <profile> a
                          bundled profile's id
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

/** Runs `core capture` (ADR 6): no transport is written in TypeScript. */
async function capture(
  core: string,
  endpoint: string,
  unit: string,
  profile: string,
): Promise<string> {
  const args = ["capture", "--endpoint", endpoint, "--unit", unit, "--profile", profile];
  const child = Bun.spawn([core, ...args], { stdout: "pipe", stderr: "pipe" });

  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  if (code !== 0) throw new Error(`sunreye capture exited ${code}: ${err.trim()}`);

  return out;
}

/** Each command and the arguments it takes; `core` is the core binary. */
function commands(
  core: string,
): ReadonlyMap<string, (args: readonly string[]) => Promise<string> | undefined> {
  return new Map<string, (args: readonly string[]) => Promise<string> | undefined>([
    ["lint", ([path]) => (path === undefined ? undefined : lint(path))],
    [
      "decode",
      ([path, dump]) => (path === undefined || dump === undefined ? undefined : decode(path, dump)),
    ],
    ["build", ([dir]) => (dir === undefined ? undefined : build(dir))],
    [
      "capture",
      ([endpoint, unit, profile]) =>
        endpoint === undefined || unit === undefined || profile === undefined
          ? undefined
          : capture(core, endpoint, unit, profile),
    ],
  ]);
}

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

/**
 * Runs one command: 0 on success, 1 with the reason it failed, 2 with the usage. `core` is the
 * core binary `capture` runs.
 */
export function run(
  [command = "", ...args]: readonly string[],
  core = process.env["SUNREYE_CORE"] ?? "sunreye",
): Promise<Ran> {
  const output = commands(core).get(command)?.(args);

  return output === undefined ? Promise.resolve({ code: 2, out: "", err: usage }) : report(output);
}

if (import.meta.main) {
  const { code, out, err } = await run(process.argv.slice(2));

  process.stdout.write(out);
  process.stderr.write(err);
  process.exitCode = code;
}

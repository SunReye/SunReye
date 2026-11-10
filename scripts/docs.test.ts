// Every command the docs show must exist (ADR 13): each `sunreye`, `sunreye-profile` and `bun`
// invocation in a fenced shell block, read against the code that parses it.
import { expect, test } from "bun:test";
import { Glob } from "bun";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { run } from "../packages/sdk/src/cli.ts";

type Check = (args: readonly string[]) => Promise<string[]>;

const root = new URL("..", import.meta.url).pathname;

/** The source file that parses each core subcommand's flags; `serve` is the bare `sunreye`. */
const parsers = new Map([
  ["serve", "startup.rs"],
  ["capture", "capture.rs"],
  ["import", "import.rs"],
  ["backup", "backup.rs"],
  ["restore", "backup.rs"],
]);

/** Docker options that take a value, so the image is the first token after them. */
const dockerValued = new Set(["-v", "-p", "-e", "--name", "--restart", "--device", "--network"]);

const text = (path: string): Promise<string> => readFile(join(root, path), "utf8");

/** Each match's first group, else the whole match. */
function captures(source: string, pattern: Readonly<RegExp>): string[] {
  const found: string[] = [];

  for (const match of source.matchAll(pattern)) found.push(match[1] ?? match[0]);

  return found;
}

/** The subcommands `main.rs` routes on. */
async function coreSubcommands(): Promise<string[]> {
  return captures(await text("crates/core/src/main.rs"), /arg == "(\w+)"/gu);
}

/** The flags a core source file parses, `--data-dir=` read as `--data-dir`. */
async function coreFlags(sub: string): Promise<Set<string>> {
  const source = await text(`crates/core/src/${parsers.get(sub) ?? ""}`);

  return new Set(captures(source, /"(--[a-z][a-z-]*)=?"/gu));
}

/** The commands `sunreye-profile` lists in its usage. */
async function sdkCommands(): Promise<Set<string>> {
  const { err } = await run([]);

  return new Set(captures(err, /^ {2}(\w+) /gmu));
}

/** Every `SUNREYE_*` name the code reads: literals, and each startup flag's fallback (ADR 2). */
async function variables(): Promise<Set<string>> {
  const dirs = ["crates/core/src", "packages/sdk/src", "scripts", "packaging"];
  const scans = dirs.map((dir) => Array.fromAsync(new Glob(`${dir}/**/*.{rs,ts}`).scan(root)));
  // Tests name variables that do not exist, this one among them.
  const files = (await Promise.all(scans)).flat().filter((file) => !file.endsWith(".test.ts"));
  const sources = await Promise.all(files.map((file) => text(file)));

  const startup = [...(await coreFlags("serve"))].map(
    (flag) => `SUNREYE_${flag.slice(2).replaceAll("-", "_").toUpperCase()}`,
  );

  return new Set([
    ...sources.flatMap((source) => captures(source, /SUNREYE_[A-Z_]+/gu)),
    ...startup,
  ]);
}

async function checkCore(args: readonly string[]): Promise<string[]> {
  const [first = ""] = args;
  const sub = (await coreSubcommands()).includes(first) ? first : "serve";

  if (sub === "serve" && first !== "" && !first.startsWith("--")) {
    return [`sunreye: no subcommand or flag \`${first}\``];
  }

  const flags = await coreFlags(sub);
  const name = sub === "serve" ? "sunreye" : `sunreye ${sub}`;

  return args.flatMap((arg) => {
    const flag = arg.split("=")[0] ?? "";

    return arg.startsWith("--") && !flags.has(flag) ? [`${name}: no flag \`${flag}\``] : [];
  });
}

async function checkSdk([command = ""]: readonly string[]): Promise<string[]> {
  return (await sdkCommands()).has(command) ? [] : [`sunreye-profile: no command \`${command}\``];
}

/** The scripts the `package.json` in `dir` declares. */
async function scripts(dir: string): Promise<string[]> {
  const manifest: unknown = JSON.parse(await text(join(dir, "package.json")));

  return manifest instanceof Object && "scripts" in manifest && manifest.scripts instanceof Object
    ? Object.keys(manifest.scripts)
    : [];
}

async function checkBunRun(args: readonly string[]): Promise<string[]> {
  const [dir, rest] = args[0] === "--cwd" ? [args[1] ?? "", args.slice(2)] : [".", args];
  const [script = ""] = rest;

  return (await scripts(dir)).includes(script)
    ? []
    : [`bun run: ${dir} has no script \`${script}\``];
}

function checkBun([first = "", ...rest]: readonly string[]): Promise<string[]> {
  if (first === "run") return checkBunRun(rest);

  if (first === "install") return Promise.resolve([]);

  if (!existsSync(join(root, first))) return Promise.resolve([`bun: no file \`${first}\``]);

  return first === "packages/sdk/src/cli.ts" ? checkSdk(rest) : Promise.resolve([]);
}

/** `docker run … <image> <args>` runs the core when the image is SunReye's. */
function checkDocker([verb, ...args]: readonly string[]): Promise<string[]> {
  if (verb !== "run") return Promise.resolve([]);

  let at = 0;

  while (args[at]?.startsWith("-") === true) at += dockerValued.has(args[at] ?? "") ? 2 : 1;

  const image = args[at] ?? "";

  return /(?:^|\/)sunreye-v5(?::|$)/u.test(image)
    ? checkCore(args.slice(at + 1))
    : Promise.resolve([]);
}

const checks = new Map<string, Check>([
  ["sunreye", checkCore],
  ["sunreye-profile", checkSdk],
  ["bun", checkBun],
  ["docker", checkDocker],
]);

function checkCommand(words: readonly string[]): Promise<string[]> {
  const start = words.findIndex((word) => word !== "sudo" && !/^[A-Z_]+=/u.test(word));
  const [program = "", ...args] = words.slice(start);

  return checks.get(basename(program))?.(args) ?? Promise.resolve([]);
}

/** Each command in the markdown's fenced shell blocks, as words. */
function commands(markdown: string): readonly (readonly string[])[] {
  const bodies = captures(markdown, /^ *```(?:sh|bash|shell)\n([\s\S]*?)^ *```/gmu);

  return bodies
    .flatMap((body) => body.replaceAll("\\\n", " ").split("\n"))
    .flatMap((line) => (line.trim() === "" || line.trimStart().startsWith("#") ? [] : [line]))
    .flatMap((line) => line.split(/&&|\|\||;|\|/u))
    .map((command) => command.replaceAll(/["']/gu, "").trim().split(/\s+/u));
}

async function problems(markdown: string): Promise<string[]> {
  const found = await Promise.all(commands(markdown).map((words) => checkCommand(words)));
  const known = await variables();
  const named = new Set(captures(markdown, /SUNREYE_[A-Z_]+/gu));

  const unknown = [...named].flatMap((name) =>
    known.has(name) ? [] : [`no variable \`${name}\``],
  );

  return [...found.flat(), ...unknown];
}

test("a command, flag or script that does not exist is reported", async () => {
  const markdown = [
    "```sh",
    "sunreye export --out x.tar.gz",
    "sunreye backup b.tar --secret",
    "docker run --rm -v data:/data sunreye-v5 import x.tar.gz --map a=1",
    "bun run --cwd apps/web deploy",
    "bun packages/sdk/src/cli.ts sign my.ts",
    "SUNREYE_PORT=80 sunreye",
    "```",
  ].join("\n");

  expect(await problems(markdown)).toEqual([
    "sunreye: no subcommand or flag `export`",
    "sunreye backup: no flag `--secret`",
    "sunreye import: no flag `--map`",
    "bun run: apps/web has no script `deploy`",
    "sunreye-profile: no command `sign`",
    "no variable `SUNREYE_PORT`",
  ]);
});

test("the guides show only commands, flags, scripts and variables that exist", async () => {
  const names = await readdir(join(root, "docs"));
  const guides = names.filter((name) => name.endsWith(".md"));
  const found = await Promise.all(guides.map(async (name) => problems(await text(`docs/${name}`))));

  expect(
    ["install.md", "move-from-v3.md", "profiles.md"].every((name) => guides.includes(name)),
  ).toBe(true);
  expect(found.flat()).toEqual([]);
});

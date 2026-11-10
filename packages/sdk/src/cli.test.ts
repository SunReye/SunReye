import { expect, test } from "bun:test";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./cli.ts";

const meter = {
  schema: 1,
  id: "meter",
  name: "Meter",
  manufacturer: "Test",
  version: "1.0.0",
  requires: ["modbus", "u16", "u32"],
  quantities: [
    { key: "power", role: "grid.power", register: 10, type: "u16" },
    { key: "energy", role: "grid.energy", register: 20, type: "u32" },
  ],
};

/** Writes `files` into a fresh directory and returns it. */
async function directory(files: Readonly<Record<string, string>>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cli-"));

  await Promise.all(
    Object.keys(files).map((name) => writeFile(join(dir, name), files[name] ?? "")),
  );

  return dir;
}

test("lint fails a profile module that uses a capability it does not require", async () => {
  const unrequired = { ...meter, requires: ["modbus", "u16"] };
  const dir = await directory({ "meter.ts": `export default ${JSON.stringify(unrequired)};` });

  expect(await run(["lint", join(dir, "meter.ts")])).toEqual({
    code: 1,
    out: "",
    err: "error: `requires` lacks `u32`, which the profile uses\n",
  });
});

test("lint fails with the loader's reason for a profile file the core would refuse", async () => {
  const dir = await directory({ "meter.json": JSON.stringify({ ...meter, schema: 2 }) });

  expect(await run(["lint", join(dir, "meter.json")])).toEqual({
    code: 1,
    out: "",
    err: "error: schema 2 is not supported; this build loads schema 1\n",
  });
});

test("decode prints each quantity's value from a register dump", async () => {
  const dump = JSON.stringify([
    { start: 10, words: [230] },
    { start: 20, words: [1, 2] },
  ]);

  const dir = await directory({ "meter.json": JSON.stringify(meter), "dump.json": dump });
  const { code, out } = await run(["decode", join(dir, "meter.json"), join(dir, "dump.json")]);
  const values: unknown = JSON.parse(out);

  expect({ code, values }).toEqual({
    code: 0,
    values: { power: 230, energy: 131_073 },
  });
});

test("build prints each profile's published version", async () => {
  const dir = await directory({ "meter.ts": `export default ${JSON.stringify(meter)};` });

  expect(await run(["build", dir])).toEqual({
    code: 0,
    out: "meter 1.0.0\n",
    err: "",
  });
});

/** A stand-in for the core binary: prints its arguments, or fails with them when `fails`. */
async function core(fails: boolean): Promise<string> {
  const dir = await directory({
    sunreye: fails ? '#!/bin/sh\necho "refused: $*" >&2\nexit 1\n' : '#!/bin/sh\necho "$*"\n',
  });

  const path = join(dir, "sunreye");

  await chmod(path, 0o755);

  return path;
}

test("capture runs the core's capture subcommand and prints the capture it writes", async () => {
  const args = ["capture", "modbus-tcp://10.20.0.62:502", "0", "deye-sg05lp3"];

  expect(await run(args, await core(false))).toEqual({
    code: 0,
    out: "capture --endpoint modbus-tcp://10.20.0.62:502 --unit 0 --profile deye-sg05lp3\n",
    err: "",
  });
});

test("capture fails with the core's reason", async () => {
  const { code, err } = await run(["capture", "sim://x:1", "0", "p"], await core(true));

  expect({ code, err }).toEqual({
    code: 1,
    err: "error: sunreye capture exited 1: refused: capture --endpoint sim://x:1 --unit 0 --profile p\n",
  });
});

test("an unknown command prints the usage", async () => {
  const { code, err } = await run(["publish"]);

  expect({ code, usage: err.startsWith("usage: sunreye-profile") }).toEqual({
    code: 2,
    usage: true,
  });
});

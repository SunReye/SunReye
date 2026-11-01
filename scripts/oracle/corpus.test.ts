import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CORPUS_DIR, hex, ndjson, staleFiles, writeCorpus } from "./corpus";

describe("ndjson", () => {
  test("one compact document per line, newline-terminated", () => {
    expect(ndjson([{ a: 1 }, { b: [1, 2], c: null }])).toBe('{"a":1}\n{"b":[1,2],"c":null}\n');
  });

  test("an empty corpus file is just a newline", () => {
    expect(ndjson([])).toBe("\n");
  });
});

describe("hex", () => {
  test("lowercase, unseparated, zero-padded", () => {
    expect(hex(Uint8Array.from([0x00, 0x0a, 0xff]))).toBe("000aff");
  });

  test("empty input is the empty string", () => {
    expect(hex(new Uint8Array(0))).toBe("");
  });
});

describe("the corpus on disk", () => {
  let dir = "";
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "oracle-corpus-"));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  test("lives at fixtures/oracle", () => {
    expect(CORPUS_DIR.endsWith("/fixtures/oracle/")).toBe(true);
  });

  test("writeCorpus creates nested directories and keeps bytes exactly", async () => {
    await writeCorpus({ "a.ndjson": "x\n", "nested/b.bin": Uint8Array.from([0, 255, 1]) }, dir);
    expect(await readFile(join(dir, "a.ndjson"), "utf8")).toBe("x\n");
    expect([...(await readFile(join(dir, "nested/b.bin")))]).toEqual([0, 255, 1]);
  });

  test("a file that matches is not stale", async () => {
    await writeCorpus({ "same.txt": "one\n" }, dir);
    expect(await staleFiles({ "same.txt": "one\n" }, dir)).toEqual([]);
  });

  test("a changed file, a missing file and a changed binary are all stale, sorted", async () => {
    await writeCorpus({ "changed.txt": "old\n", "bin.dat": Uint8Array.from([1, 2]) }, dir);
    await writeFile(join(dir, "changed.txt"), "old\n");
    const stale = await staleFiles(
      { "missing.txt": "x", "changed.txt": "new\n", "bin.dat": Uint8Array.from([1, 3]) },
      dir,
    );
    expect(stale).toEqual(["bin.dat", "changed.txt", "missing.txt"]);
  });

  test("a trailing byte difference is stale", async () => {
    await writeCorpus({ "tail.txt": "abc" }, dir);
    expect(await staleFiles({ "tail.txt": "abc\n" }, dir)).toEqual(["tail.txt"]);
  });
});

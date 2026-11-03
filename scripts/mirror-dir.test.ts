import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { mirrorDir } from "./mirror-dir";

let root: string;
let from: string;
let to: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mirror-dir-"));
  from = join(root, "from");
  to = join(root, "to");
  mkdirSync(from);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const put = (dir: string, path: string, text: string) => {
  const file = join(dir, path);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, text);
  return file;
};

test("copies a tree into a directory that does not exist yet", () => {
  put(from, "index.html", "shell");
  put(from, "_app/immutable/a.js", "a");
  mirrorDir(from, to);
  expect(readFileSync(join(to, "index.html"), "utf8")).toBe("shell");
  expect(readFileSync(join(to, "_app/immutable/a.js"), "utf8")).toBe("a");
});

test("leaves a file with the same bytes untouched, mtime included, so cargo sees no change", () => {
  put(from, "a.js", "same");
  const kept = put(to, "a.js", "same");
  const old = new Date("2020-01-01T00:00:00Z");
  utimesSync(kept, old, old);
  mirrorDir(from, to);
  expect(statSync(kept).mtimeMs).toBe(old.getTime());
});

test("rewrites a file whose bytes differ", () => {
  put(from, "a.js", "new");
  const stale = put(to, "a.js", "old");
  mirrorDir(from, to);
  expect(readFileSync(stale, "utf8")).toBe("new");
});

test("removes what the source no longer has, empty directories included", () => {
  put(from, "keep.html", "k");
  put(to, "keep.html", "k");
  put(to, "server/index.js", "node build leftover");
  mirrorDir(from, to);
  expect(existsSync(join(to, "server"))).toBe(false);
  expect(existsSync(join(to, "keep.html"))).toBe(true);
});

test("a file where the source has a directory is replaced", () => {
  put(from, "x/y.txt", "y");
  put(to, "x", "was a file");
  mirrorDir(from, to);
  expect(readFileSync(join(to, "x/y.txt"), "utf8")).toBe("y");
});

test("a missing source is refused, not read as an empty tree", () => {
  expect(() => mirrorDir(join(root, "absent"), to)).toThrow(/absent/);
});

/**
 * The single-binary pipeline's wiring, which fails silently when it is wrong.
 *
 * `bun build --compile --asset ../web/build` reads that directory at BUILD time.
 * If the static web build has not run, the compile still succeeds (the script
 * creates the directory) and produces a binary that 404s every dashboard path
 * while serving the API perfectly. Nothing throws, no test goes red, and the
 * only symptom is a blank page — so the ordering is asserted here rather than
 * left to whoever edits turbo.json next.
 */
import { describe, expect, it } from "bun:test";

const read = async (path: string): Promise<Record<string, unknown>> =>
  (await Bun.file(new URL(`../${path}`, import.meta.url)).json()) as Record<string, unknown>;

const scripts = async (path: string): Promise<Record<string, string>> =>
  ((await read(path)).scripts ?? {}) as Record<string, string>;

const turboTask = async (name: string): Promise<Record<string, unknown>> => {
  const tasks = (await read("turbo.json")).tasks as Record<string, Record<string, unknown>>;
  return tasks[name] ?? {};
};

describe("the compile script", () => {
  it("embeds the web build", async () => {
    expect((await scripts("apps/server/package.json")).compile).toContain("--asset ../web/build");
  });

  // Belt for a direct `bun run compile` on a fresh clone: --asset on a missing
  // directory is a hard build error, not a warning.
  it("creates the asset directory so a fresh clone can compile at all", async () => {
    expect((await scripts("apps/server/package.json")).compile).toContain("mkdir -p ../web/build");
  });
});

describe("the compile turbo task", () => {
  it("runs the static web build first", async () => {
    expect((await turboTask("compile")).dependsOn).toContain("web#build:static");
  });

  it("declares the binary as its output, so a cache hit restores it", async () => {
    expect((await turboTask("compile")).outputs).toContain("server");
  });

  it("has a build:static task whose output is the directory --asset reads", async () => {
    expect((await turboTask("build:static")).outputs).toContain("build/**");
  });
});

describe("running the binary", () => {
  // dotenv resolves .env from process.cwd(), and turbo runs a package script
  // with the package as cwd — which is the only reason `./server` finds
  // apps/server/.env. A root-level `./apps/server/server` does not.
  // `start` is already the tsdown bundle (`bun run dist/index.mjs`), hence the
  // separate name — the two are different artifacts, not two ways to run one.
  it("is a script in apps/server, so .env resolves", async () => {
    expect((await scripts("apps/server/package.json"))["start:binary"]).toBe("./server");
  });

  it("compiles before it runs, and is never cached", async () => {
    const task = await turboTask("start:binary");
    expect(task.dependsOn).toContain("compile");
    expect(task.cache).toBe(false);
    expect(task.persistent).toBe(true);
  });
});

describe("the root entry points", () => {
  it("exposes both halves", async () => {
    const root = await scripts("package.json");
    expect(root.compile).toContain("turbo run compile");
    expect(root.binary).toContain("turbo run start:binary");
  });
});

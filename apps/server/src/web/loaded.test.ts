import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diskBuildDir, resolveAssets } from "./loaded";

const bytes = (s: string) => new TextEncoder().encode(s);
const text = (u: Uint8Array | undefined) => (u ? new TextDecoder().decode(u) : undefined);

/**
 * `Bun.embeddedFiles` hands back blobs carrying the name `--asset` packed them
 * under — the asset directory's basename, then the path within it.
 */
const embedded = (name: string, body: string) => new File([bytes(body)], name);

const buildOnDisk = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), "sunreye-assets-"));
  for (const [relative, body] of Object.entries(files)) {
    const at = join(dir, relative);
    mkdirSync(join(at, ".."), { recursive: true });
    writeFileSync(at, body);
  }
  return dir;
};

const absent = () => join(tmpdir(), "sunreye-assets-does-not-exist");

describe("diskBuildDir", () => {
  it("points at the sibling web build when running from source", () => {
    expect(diskBuildDir("/home/user/SunReye/apps/server/src/web")).toBe(
      "/home/user/SunReye/apps/web/build",
    );
  });

  // Inside a compiled binary every module lives at bun's virtual root, so the
  // relative path above escapes to `/web/build` on the HOST. Reading that would
  // let a stray directory become the dashboard.
  it("declines to name a disk path inside a compiled binary", () => {
    expect(diskBuildDir("/$bunfs/root")).toBeNull();
  });

  it("does not mistake a real directory for the virtual one", () => {
    expect(diskBuildDir("/bunfs/root/src/web")).toBe("/bunfs/web/build");
  });
});

describe("resolveAssets from an embedded build", () => {
  it("maps every packed file to the URL path it answers", async () => {
    const assets = await resolveAssets(
      [
        embedded("build/index.html", "<body>SunReye</body>"),
        embedded("build/_app/immutable/entry/app.CAFEBABE.js", "console.log(1)"),
      ],
      null,
    );
    expect([...assets.keys()].sort()).toEqual([
      "/_app/immutable/entry/app.CAFEBABE.js",
      "/index.html",
    ]);
    expect(text(assets.get("/index.html"))).toBe("<body>SunReye</body>");
  });

  it("preserves bytes that are not text", async () => {
    const raw = new Uint8Array([0, 255, 13, 10, 0, 127, 200]);
    const assets = await resolveAssets([new File([raw], "build/favicon.ico")], null);
    expect([...(assets.get("/favicon.ico") ?? [])]).toEqual([...raw]);
  });

  // A binary may embed files for unrelated reasons; only the build's own may
  // become routes.
  it("ignores an embedded file from outside the asset directory", async () => {
    const assets = await resolveAssets(
      [embedded("elsewhere/notes.txt", "hi"), embedded("buildx/index.html", "decoy")],
      null,
    );
    expect(assets.size).toBe(0);
  });

  it("ignores the asset directory's own entry", async () => {
    expect((await resolveAssets([embedded("build", ""), embedded("build/", "")], null)).size).toBe(
      0,
    );
  });

  // The compiled binary must not prefer the host's filesystem over itself.
  it("prefers the embedded build over one on disk", async () => {
    const dir = buildOnDisk({ "index.html": "from disk" });
    const assets = await resolveAssets([embedded("build/index.html", "embedded")], dir);
    expect(text(assets.get("/index.html"))).toBe("embedded");
  });
});

describe("resolveAssets from the build on disk", () => {
  // `Bun.embeddedFiles` is empty under `bun run`, which is how dev and the test
  // suite reach the build the compiled binary carries inside it.
  it("walks nested directories and keys every file at the URL root", async () => {
    const dir = buildOnDisk({ "index.html": "<body/>", "_app/immutable/app.js": "1" });
    const assets = await resolveAssets([], dir);
    expect([...assets.keys()].sort()).toEqual(["/_app/immutable/app.js", "/index.html"]);
    expect(text(assets.get("/_app/immutable/app.js"))).toBe("1");
  });

  // A recursive readdir reports directories alongside files, and reading one
  // throws — so this would take the whole boot down, not just one asset.
  it("does not mistake a directory for an asset", async () => {
    const assets = await resolveAssets([], buildOnDisk({ "_app/immutable/app.js": "1" }));
    expect(assets.has("/_app")).toBe(false);
    expect(assets.has("/_app/immutable")).toBe(false);
    expect(assets.size).toBe(1);
  });

  it("returns nothing when the build directory is absent", async () => {
    expect((await resolveAssets([], absent())).size).toBe(0);
  });

  it("returns nothing for an empty build directory", async () => {
    expect((await resolveAssets([], buildOnDisk({}))).size).toBe(0);
  });

  // The API-only binary: compiled without --asset, so nothing is embedded and
  // there is deliberately no disk to fall back to.
  it("reads no disk at all when offered none", async () => {
    expect((await resolveAssets([], null)).size).toBe(0);
  });
});

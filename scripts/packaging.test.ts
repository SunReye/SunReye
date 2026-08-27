/**
 * What the shipped images are made of.
 *
 * Every assertion here stands for a failure that is either silent or reports
 * something unrelated to its cause:
 *
 * - A glibc `bun build --target` on a musl base (or the reverse) fails to exec
 *   with a bare "No such file or directory" — the missing file is the dynamic
 *   loader, not the binary, and nothing says so.
 * - Compiling `index.ts` instead of `main.ts` drops the argv dispatch, so
 *   `migrate` boots the *server* against the database instead of migrating it.
 *   The container starts, logs normally, and the schema is never brought
 *   forward.
 * - Without the trust store every outbound HTTPS call (spot prices, solar
 *   forecast) fails at runtime only; without the zone database every day,
 *   month and tariff-band boundary silently cuts in UTC.
 *
 * The Dockerfiles are read as text because that is what `docker build` reads.
 * This proves the wiring, not that the image runs — `bun run test:binary`
 * compiles and executes a real binary, and the image itself is built in CI.
 */
import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";

const at = (path: string) => new URL(`../${path}`, import.meta.url);
const read = async (path: string) => await Bun.file(at(path)).text();
const yaml = async (path: string) => Bun.YAML.parse(await read(path)) as ComposeFile;

interface ComposeService {
  image?: string;
  build?: { dockerfile?: string };
  command?: string[];
  environment?: Record<string, string>;
  depends_on?: Record<string, { condition?: string }>;
}
interface ComposeFile {
  services: Record<string, ComposeService>;
}

/** A Dockerfile with line continuations folded, so one RUN reads as one line. */
const folded = async (path: string) => (await read(path)).replaceAll(/\\\r?\n\s*/g, " ");

/** The `FROM` line that opens the final stage — the base the image ships on. */
function runtimeBase(dockerfile: string): string {
  const froms = [...dockerfile.matchAll(/^FROM\s+(\S+)/gm)].map((m) => m[1] as string);
  return froms.at(-1) ?? "";
}

/** Every `--target=` bun handed a compile in this file. */
function compileTargets(dockerfile: string): string[] {
  return [...dockerfile.matchAll(/\b(bun-linux-[a-z0-9-]+)\b/g)].map((m) => m[1] as string);
}

const SERVER = "apps/server/Dockerfile";
const ADDON = "sunreye/Dockerfile";

describe("the server image", () => {
  it("compiles the argv dispatcher, so `migrate` migrates instead of serving", async () => {
    expect(await folded(SERVER)).toContain("./src/main.ts");
  });

  it("embeds the dashboard, and creates nothing for --asset to miss", async () => {
    expect(await folded(SERVER)).toContain("--asset ../web/build");
  });

  // modbus-serial only requires it from its RTU-over-serial connectors, which
  // SunReye never uses — and bun's bundler emits a syntax error into the
  // bundled wrapper that breaks parsing of the whole binary at startup.
  it("keeps serialport external", async () => {
    expect(await folded(SERVER)).toContain("--external serialport");
  });

  it("builds musl binaries for both published architectures", async () => {
    expect(compileTargets(await folded(SERVER)).sort()).toEqual([
      "bun-linux-arm64-musl",
      "bun-linux-x64-musl",
    ]);
  });

  it("ships on scratch — no shell, no package manager, nothing to update", async () => {
    expect(runtimeBase(await folded(SERVER))).toBe("scratch");
  });

  describe("carries what a musl bun binary cannot start or work without", () => {
    // Not a glob: an arm64 image needs ld-musl-aarch64 and an amd64 one
    // ld-musl-x86_64, and the stage that copies them is built for the target.
    it("the musl loader", async () => {
      expect(await folded(SERVER)).toMatch(/ld-musl-\S*\.so\.1/);
    });

    it("the C++ and GCC runtimes it links against", async () => {
      const text = await folded(SERVER);
      expect(text).toContain("libstdc++.so.6");
      expect(text).toContain("libgcc_s.so.1");
    });

    it("the trust store, or every outbound HTTPS call fails", async () => {
      expect(await folded(SERVER)).toContain("ca-certificates.crt");
    });

    it("the zone database, or every day boundary cuts in UTC", async () => {
      expect(await folded(SERVER)).toContain("zoneinfo");
    });
  });

  describe("carries the migration files the dispatcher reads", () => {
    const dirs = [
      ["MIGRATIONS_DIR", "packages/db/src/migrations"],
      ["TIMESCALE_DIR", "packages/db/src/timescale"],
    ] as const;

    for (const [variable, source] of dirs) {
      // The runner reads plain files; a compiled binary bundles modules only.
      it(`copies ${source} and points ${variable} at it`, async () => {
        const text = await folded(SERVER);
        const copy = new RegExp(`COPY --from=build /app/${source} (\\S+)`);
        const destination = text.match(copy)?.[1];
        expect(destination).toBeString();
        expect(text).toContain(`${variable}=${destination}`);
      });
    }
  });

  it("runs as a non-root uid", async () => {
    expect(await folded(SERVER)).toMatch(/^USER\s+(?!0|root)\S+/m);
  });
});

describe("the addon image", () => {
  // The HA base image is Debian. A musl target here would exec-fail with a
  // bare "No such file or directory", so the two files deliberately differ.
  it("builds glibc binaries, matching its glibc base", async () => {
    expect(compileTargets(await folded(ADDON)).sort()).toEqual([
      "bun-linux-arm64",
      "bun-linux-x64",
    ]);
  });

  it("compiles the same argv dispatcher as the server image", async () => {
    expect(await folded(ADDON)).toContain("apps/server/src/main.ts");
  });
});

describe("the images that no longer exist", () => {
  // The binary serves the dashboard, so there is no second image for it, and
  // no bun-toolchain image to run migrations from.
  const retired = ["apps/web/Dockerfile", "docker/migrate.Dockerfile"];

  for (const path of retired) {
    it(`${path} is gone`, () => {
      expect(existsSync(at(path))).toBe(false);
    });
  }

  it("no workflow builds one", async () => {
    const dir = new Bun.Glob("*.yml").scan({
      cwd: new URL("../.github/workflows", import.meta.url).pathname,
    });
    for await (const file of dir) {
      const text = await read(`.github/workflows/${file}`);
      for (const path of retired) expect(text).not.toContain(path);
    }
  });
});

describe.each(["docker-compose.yml", "docker/docker-compose.yml"])("%s", (path) => {
  it("has no separate web service", async () => {
    expect(Object.keys((await yaml(path)).services)).not.toContain("web");
  });

  it("migrates with the server's own image, so schema and code cannot diverge", async () => {
    const { migrate, server } = (await yaml(path)).services;
    expect(migrate).toBeDefined();
    // Same artifact, named the same way this file names the server's.
    expect(migrate?.image ?? migrate?.build?.dockerfile).toBe(
      server?.image ?? server?.build?.dockerfile,
    );
    expect(migrate?.command).toEqual(["migrate"]);
  });

  it("holds the server back until the migration has exited 0", async () => {
    const server = (await yaml(path)).services.server;
    expect(server?.depends_on?.migrate?.condition).toBe("service_completed_successfully");
  });
});

describe("the local compile", () => {
  // Whatever `bun run compile` produces is what gets debugged; if it is not the
  // dispatcher, the `migrate` path is only ever exercised in an image.
  it("builds the same entry point the images do", async () => {
    const pkg = (await Bun.file(at("apps/server/package.json")).json()) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.compile).toContain("./src/main.ts");
  });
});

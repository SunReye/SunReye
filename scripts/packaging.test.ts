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
  ports?: string[];
  environment?: Record<string, string>;
  depends_on?: Record<string, { condition?: string }>;
}
interface ComposeFile {
  services: Record<string, ComposeService>;
}

/** A Dockerfile with line continuations folded, so one RUN reads as one line. */
const folded = async (path: string) => (await read(path)).replaceAll(/\\\r?\n\s*/g, " ");

/**
 * The same, with comments removed — what docker actually acts on. Needed
 * wherever a prose mention would otherwise read as an instruction: the addon's
 * header comment explains that nginx is gone, and says "nginx" doing so.
 */
const instructions = async (path: string) =>
  (await folded(path))
    .split("\n")
    .map((line) => line.replace(/(^|\s)#.*$/, ""))
    .join("\n");

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

  // This compile runs from the repo root, not from apps/server, so the path
  // --asset is given differs from the server image's. Getting it wrong is not
  // a build error once the directory exists: the binary serves the API
  // perfectly and 404s every dashboard path.
  it("embeds the dashboard, at a path relative to the repo root", async () => {
    expect(await folded(ADDON)).toContain("--asset apps/web/build");
  });

  describe("has no nginx left in it", () => {
    it("installs and runs no nginx", async () => {
      expect(await instructions(ADDON)).not.toContain("nginx");
    });

    it("copies no static build for one to serve", async () => {
      expect(await instructions(ADDON)).not.toContain("/opt/sunreye/web");
    });

    const gone = [
      "sunreye/rootfs/etc/nginx/sunreye.conf",
      "sunreye/rootfs/etc/nginx/sunreye-locations.conf",
      "sunreye/rootfs/etc/s6-overlay/s6-rc.d/svc-nginx/run",
      "sunreye/rootfs/etc/s6-overlay/s6-rc.d/user/contents.d/svc-nginx",
    ];
    for (const path of gone) {
      it(`${path} is gone`, () => {
        expect(existsSync(at(path))).toBe(false);
      });
    }
  });
});

describe("the addon's front door", () => {
  const readText = async (path: string) => await read(path);
  const SVC_SERVER = "sunreye/rootfs/etc/s6-overlay/s6-rc.d/svc-server/run";
  const INIT_ENV = "sunreye/rootfs/etc/s6-overlay/s6-rc.d/init-env/run";

  /** The container port the Supervisor proxies ingress to. */
  const ingressPort = async (): Promise<number> => {
    const config = Bun.YAML.parse(await read("sunreye/config.yaml")) as {
      ingress_port: number;
      ports: Record<string, number | null>;
    };
    return config.ingress_port;
  };

  it("serves ingress and the optional direct port from one listener", async () => {
    const config = Bun.YAML.parse(await read("sunreye/config.yaml")) as {
      ingress_port: number;
      ports: Record<string, number | null>;
      ports_description: Record<string, string>;
    };
    const published = Object.keys(config.ports);
    expect(published).toEqual([`${config.ingress_port}/tcp`]);
    // `null` = mapping disabled, so nothing reaches it from the LAN until the
    // user assigns a host port themselves.
    expect(config.ports[`${config.ingress_port}/tcp`]).toBeNull();
    expect(Object.keys(config.ports_description)).toEqual(published);
  });

  it("maps /share read-write, so an export can leave the addon at all", async () => {
    // Without a `map:` block the addon can hand the user nothing but a Home
    // Assistant backup, which is a restore vehicle rather than a file you can
    // copy off the box. `share:rw` is what puts the portable export somewhere the
    // Samba add-on and the File Editor can both see it.
    const config = Bun.YAML.parse(await read("sunreye/config.yaml")) as {
      map?: string[];
    };
    expect(config.map).toBeDefined();
    expect(config.map).toContain("share:rw");
  });

  it("does not map anything the export does not need", async () => {
    // A map entry is a hole in the addon's isolation. `/share` is the one the
    // export needs; `/config`, `/ssl`, `/media`, `/backup` are not, and adding one
    // "while we are here" is how an addon quietly gains reach over the whole box.
    const config = Bun.YAML.parse(await read("sunreye/config.yaml")) as { map?: string[] };
    expect(config.map).toEqual(["share:rw"]);
  });

  it("binds the port the Supervisor actually connects to", async () => {
    expect(await readText(SVC_SERVER)).toContain(`export PORT=${await ingressPort()}`);
  });

  // The whole reason this is asserted: 127.0.0.1 was right while nginx sat on
  // loopback in front. With the binary as the front door it means the
  // Supervisor (172.30.32.2) gets connection refused, and the addon shows an
  // empty ingress panel with nothing in the log.
  it("binds every interface, not just loopback", async () => {
    expect(await readText(INIT_ENV)).toContain("set_env HOST 0.0.0.0");
    expect(await readText(INIT_ENV)).not.toContain("set_env HOST 127.0.0.1");
  });

  it("watchdogs and healthchecks that same port", async () => {
    const port = await ingressPort();
    expect(await read("sunreye/config.yaml")).toContain(`[PORT:${port}]/healthz`);
    expect(await folded(ADDON)).toContain(`127.0.0.1:${port}/healthz`);
  });

  it("no longer waits on an nginx service", async () => {
    for await (const entry of new Bun.Glob("**/dependencies.d/*").scan({
      cwd: new URL("../sunreye/rootfs/etc/s6-overlay/s6-rc.d", import.meta.url).pathname,
    })) {
      expect(entry).not.toContain("nginx");
    }
  });
});

describe("the two images' toolchains", () => {
  const bunPin = (dockerfile: string): string | undefined =>
    dockerfile.match(/FROM\s+--platform=\$BUILDPLATFORM\s+(oven\/bun:\S+)\s+AS build/)?.[1];

  // They drifted, and it cost a build: the addon sat on oven/bun:1.3, where
  // directory embedding does not exist — `--asset <dir>` is read as a second
  // entry point and the build dies on `ModuleNotFound resolving "..."`. Since
  // both images now embed the dashboard, both need the same bun.
  it("pin the same bun, because both compile with --asset", async () => {
    const server = bunPin(await folded(SERVER));
    expect(server).toBeString();
    expect(bunPin(await folded(ADDON))).toBe(server as string);
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

  // A retired Dockerfile is gone from the tree, so referencing it fails loudly.
  // A retired *published image* is worse: the reference stays syntactically
  // valid and keeps working from the registry's leftovers until someone deletes
  // the tag, at which point an unrelated workflow fails with `manifest unknown`
  // and nothing connects it to the packaging change months earlier. Exactly that
  // broke `upgrade-test.yml`, which pinned `sunreye-migrate:latest` to shape a
  // pre-upgrade database long after the image stopped being published.
  const retiredImages = ["sunreye-migrate", "sunreye-web"];

  /**
   * Comment lines removed, so the assertion is about what the runner executes.
   * Explaining WHY an image was retired must stay allowed — that prose is the
   * only thing standing between the next author and re-adding the reference.
   */
  const executable = (yaml: string) =>
    yaml
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");

  it("no workflow pulls one from the registry", async () => {
    const dir = new Bun.Glob("*.yml").scan({
      cwd: new URL("../.github/workflows", import.meta.url).pathname,
    });
    for await (const file of dir) {
      const text = executable(await read(`.github/workflows/${file}`));
      for (const image of retiredImages) {
        expect(text, `${file} references the retired ${image} image`).not.toContain(
          `ghcr.io/sunreye/${image}`,
        );
      }
    }
  });

  it.each(["docker-compose.yml", "docker/docker-compose.yml"])("%s pulls neither", async (path) => {
    const text = executable(await read(path));
    for (const image of retiredImages) expect(text).not.toContain(`ghcr.io/sunreye/${image}`);
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

// The upgrade test shapes its pre-upgrade database by running the OLD tag's
// migrator, and that migrator is a host-side `bun` process, not a container —
// so it reaches Postgres over a published port. `docker/docker-compose.yml`
// deliberately publishes none (the production stack keeps the database off the
// host), which the workflow has to make up for in an override. Miss that and
// the job fails with a bare `ECONNREFUSED 127.0.0.1:5432` that says nothing
// about compose.
describe("upgrade-test.yml reaches Postgres over a port that is actually published", () => {
  const workflow = () => read(".github/workflows/upgrade-test.yml");

  /** Every `cat > docker-compose.override.yml <<'EOF' … EOF` heredoc, parsed. */
  async function overrides(): Promise<ComposeFile[]> {
    const text = await workflow();
    const blocks = [
      ...text.matchAll(/cat > docker-compose\.override\.yml <<'EOF'\n([\s\S]*?)\n\s*EOF/g),
    ];
    return blocks.map((m) => {
      // The heredoc is indented inside the `run:` block scalar; strip that.
      const lines = m[1].split("\n");
      const indent = Math.min(
        ...lines.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length),
      );
      return Bun.YAML.parse(lines.map((l) => l.slice(indent)).join("\n")) as ComposeFile;
    });
  }

  it("the production compose file publishes no database port", async () => {
    const postgres = (await yaml("docker/docker-compose.yml")).services.postgres;
    expect(postgres?.ports).toBeUndefined();
  });

  it("shapes the pre-upgrade schema from the host", async () => {
    expect(await workflow()).toContain("@localhost:5432/SunReye");
  });

  it("every override it writes publishes 5432, so no `up` can take the port away", async () => {
    const written = await overrides();
    expect(written.length).toBeGreaterThan(0);
    for (const file of written) {
      expect(file.services.postgres?.ports).toContain("5432:5432");
    }
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

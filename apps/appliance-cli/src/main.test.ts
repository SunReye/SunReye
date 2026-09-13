import { describe, expect, test } from "bun:test";
import { DEFAULT_SITE, serializeSite, type SiteConfig } from "./site";
import { type Io, run } from "./main";

type Recorded = { command: readonly string[]; cwd?: string };

/**
 * `respond` decides what each command returns; the recording happens either way.
 * Overriding `exec` wholesale would silently stop recording and make assertions
 * about what ran vacuously true, which is how a test like this passes while the
 * CLI does nothing.
 */
function harness(
  overrides: Partial<Omit<Io, "exec">> = {},
  respond: (command: readonly string[]) => { ok: boolean; output: string } = () => ({
    ok: true,
    output: "",
  }),
) {
  const runs: Recorded[] = [];
  const writes: string[] = [];
  const out: string[] = [];
  const errs: string[] = [];
  const io: Io = {
    readSite: () => serializeSite(DEFAULT_SITE),
    writeSite: (text) => writes.push(text),
    exec: (command, cwd) => {
      runs.push({ command, ...(cwd === undefined ? {} : { cwd }) });
      return respond(command);
    },
    zoneExists: (tz) => ["UTC", "Europe/Berlin"].includes(tz),
    isRoot: true,
    log: (line) => out.push(line),
    error: (line) => errs.push(line),
    ...overrides,
  };
  return { io, runs, writes, out, errs };
}

const joined = (runs: readonly Recorded[]) => runs.map((r) => r.command.join(" "));

describe("run", () => {
  test("help prints and exits 0 without touching the system", () => {
    const h = harness();
    expect(run(["--help"], h.io)).toBe(0);
    expect(h.out.join("\n")).toContain("sunreye-setup");
    expect(h.runs).toEqual([]);
    expect(h.writes).toEqual([]);
  });

  test("a validation failure exits 1, writes nothing and rebuilds nothing", () => {
    const h = harness();
    expect(run(["inverter", "nope!"], h.io)).toBe(1);
    expect(h.errs.join("\n")).toContain("not an address");
    expect(h.writes).toEqual([]);
    expect(h.runs).toEqual([]);
  });

  test("an unreadable document fails before any command runs", () => {
    const h = harness({ readSite: () => "{ broken" });
    expect(run(["timezone", "UTC"], h.io)).toBe(1);
    expect(h.errs.join("\n")).toContain("not valid JSON");
    expect(h.runs).toEqual([]);
  });

  test("an accepted change is written, committed and rebuilt, in that order", () => {
    const h = harness();
    expect(run(["timezone", "Europe/Berlin"], h.io)).toBe(0);
    expect(h.writes).toHaveLength(1);
    expect(JSON.parse(h.writes[0] ?? "{}")).toMatchObject({ timeZone: "Europe/Berlin" });
    const commands = joined(h.runs);
    expect(commands[0]).toContain("git add");
    expect(commands[1]).toContain("git");
    expect(commands[1]).toContain("commit");
    expect(commands[2]).toContain("nixos-rebuild switch --flake /etc/nixos#appliance");
  });

  test("the commit message names the change, so /etc/nixos reads as a history", () => {
    const h = harness();
    run(["timezone", "Europe/Berlin"], h.io);
    expect(joined(h.runs).join("\n")).toContain("Europe/Berlin");
  });

  test("a rebuild that fails is reported, and the exit code says so", () => {
    const h = harness({}, (command) =>
      command.includes("nixos-rebuild")
        ? { ok: false, output: "error: attribute 'appliance' missing" }
        : { ok: true, output: "" },
    );
    expect(run(["timezone", "Europe/Berlin"], h.io)).toBe(1);
    expect(h.errs.join("\n")).toContain("attribute 'appliance' missing");
    // The document is still written and committed: the rebuild is what failed,
    // and reverting it behind the operator's back would lose what they typed.
    expect(h.writes).toHaveLength(1);
  });

  test("a failing commit stops before the rebuild rather than building an untracked tree", () => {
    const h = harness({}, (command) =>
      command.includes("commit")
        ? { ok: false, output: "nothing to commit" }
        : { ok: true, output: "" },
    );
    expect(run(["timezone", "Europe/Berlin"], h.io)).toBe(1);
    expect(joined(h.runs).some((c) => c.includes("nixos-rebuild"))).toBe(false);
  });

  test("a no-op command prints and exits 0 without rebuilding", () => {
    const h = harness();
    expect(run(["timezone", "UTC"], h.io)).toBe(0);
    expect(h.writes).toEqual([]);
    expect(h.runs).toEqual([]);
    expect(h.out.join("\n")).toContain("Nothing to rebuild");
  });

  test("apply commits and rebuilds without writing the document", () => {
    const h = harness();
    expect(run(["apply"], h.io)).toBe(0);
    expect(h.writes).toEqual([]);
    expect(joined(h.runs).some((c) => c.includes("nixos-rebuild"))).toBe(true);
  });

  test("show prints the document and the tailnet status, and never rebuilds", () => {
    const h = harness({}, (command) => ({
      ok: true,
      output: command.includes("tailscale") ? "sr-abc  100.64.0.1  linux  -" : "",
    }));
    expect(run(["show"], h.io)).toBe(0);
    expect(h.out.join("\n")).toContain("simulate");
    expect(h.out.join("\n")).toContain("100.64.0.1");
    expect(joined(h.runs).some((c) => c.includes("nixos-rebuild"))).toBe(false);
  });

  test("show survives a box that has never been enrolled", () => {
    const h = harness({}, () => ({ ok: false, output: "Logged out." }));
    expect(run(["show"], h.io)).toBe(0);
    expect(h.out.join("\n")).toContain("not enrolled");
  });

  test("tailscale reset logs out, wipes the state and restarts the daemon", () => {
    const h = harness();
    expect(run(["tailscale", "reset"], h.io)).toBe(0);
    const script = joined(h.runs).join("\n");
    expect(script).toContain("tailscale logout");
    expect(script).toContain("stop tailscaled");
    expect(script).toContain("/var/lib/tailscale");
    expect(script).toContain("start tailscaled");
    // The whole point of the reset: the login window reopens.
    expect(script).toContain("tailscale-web");
  });

  test("a reset whose logout fails still wipes and restarts — a half-reset box is unreachable", () => {
    const h = harness({}, (command) => ({
      ok: !command.includes("logout"),
      output: "already logged out",
    }));
    expect(run(["tailscale", "reset"], h.io)).toBe(0);
    expect(joined(h.runs).some((c) => c.includes("start tailscaled"))).toBe(true);
  });

  test("a reset whose state wipe fails exits 1, because nothing after it can work", () => {
    const h = harness({}, (command) => ({
      ok: !command.includes("/var/lib/tailscale"),
      output: "Device or resource busy",
    }));
    expect(run(["tailscale", "reset"], h.io)).toBe(1);
  });

  test("a reset refuses for a non-root caller", () => {
    const h = harness({ isRoot: false });
    expect(run(["tailscale", "reset"], h.io)).toBe(1);
    expect(h.runs).toEqual([]);
  });

  test("every git call is made inside /etc/nixos", () => {
    const h = harness();
    run(["timezone", "Europe/Berlin"], h.io);
    for (const call of h.runs) {
      if (call.command[0] === "git") expect(call.cwd).toBe("/etc/nixos");
    }
  });

  test("the written document is what the next run parses", () => {
    const h = harness();
    run(["inverter", "192.168.1.100"], h.io);
    const written = h.writes[0] ?? "";
    const second = harness({ readSite: () => written });
    expect(run(["simulate", "off"], second.io)).toBe(0);
    expect(second.out.join("\n")).toContain("Nothing to rebuild");
  });
});

describe("systemZoneExists", () => {
  test("is backed by the zone database on the box, not a hardcoded list", async () => {
    const { systemZoneExists } = await import("./main");
    expect(systemZoneExists("UTC")).toBe(true);
    expect(systemZoneExists("Europe/Berlim")).toBe(false);
    // Traversal in a zone name would read an arbitrary file; it is not a zone.
    expect(systemZoneExists("../../etc/passwd")).toBe(false);
  });
});

describe("the document the CLI writes", () => {
  test("keeps every field, so a hand-set option is not silently dropped", () => {
    const rich: SiteConfig = {
      ...DEFAULT_SITE,
      tailscale: { enable: true },
      ssh: { authorizedKeys: ["ssh-ed25519 AAAA a@b"] },
      lan: { mode: "both", siteId: 9 },
    };
    const h = harness({ readSite: () => serializeSite(rich) });
    run(["timezone", "Europe/Berlin"], h.io);
    expect(JSON.parse(h.writes[0] ?? "{}")).toMatchObject({
      ssh: { authorizedKeys: ["ssh-ed25519 AAAA a@b"] },
      lan: { mode: "both", siteId: 9 },
    });
  });
});

describe("makeSystemIo", () => {
  test("a missing site.json reads as an empty document, which is what a first boot is", async () => {
    const { makeSystemIo } = await import("./main");
    const dir = `${import.meta.dir}/../../../coverage/appliance-cli-io-${Bun.randomUUIDv7()}`;
    const { mkdirSync, rmSync, readFileSync } = await import("node:fs");
    mkdirSync(dir, { recursive: true });
    try {
      const io = makeSystemIo({ siteJson: `${dir}/site.json`, configDir: dir });
      expect(io.readSite()).toBe("{}");

      // And what it writes is what it reads back — the round-trip the CLI's
      // second invocation depends on.
      io.writeSite(serializeSite(DEFAULT_SITE));
      expect(JSON.parse(io.readSite())).toEqual(DEFAULT_SITE);
      expect(readFileSync(`${dir}/site.json`, "utf8").endsWith("\n")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("exec reports both streams and the exit code, and never throws", async () => {
    const { makeSystemIo } = await import("./main");
    const io = makeSystemIo({ siteJson: "/nonexistent/site.json", configDir: "/" });

    const ok = io.exec(["sh", "-c", "echo out; echo err >&2"]);
    expect(ok.ok).toBe(true);
    expect(ok.output).toContain("out");
    expect(ok.output).toContain("err");

    expect(io.exec(["sh", "-c", "exit 3"]).ok).toBe(false);
    // A command that is not there at all is a failure, not an exception: on a
    // box that is what a missing nixos-rebuild looks like.
    expect(io.exec(["definitely-not-a-command-a7f3"]).ok).toBe(false);
  });

  test("cwd defaults to the config directory, so a git call lands in the right tree", async () => {
    const { makeSystemIo } = await import("./main");
    const io = makeSystemIo({ siteJson: "/tmp/site.json", configDir: "/tmp" });
    expect(io.exec(["pwd"]).output.trim()).toBe("/tmp");
    expect(io.exec(["pwd"], "/").output.trim()).toBe("/");
  });

  test("knows whether it is root, which is what gates the reset", async () => {
    const { makeSystemIo } = await import("./main");
    const io = makeSystemIo({ siteJson: "/tmp/site.json", configDir: "/tmp" });
    expect(io.isRoot).toBe(process.getuid?.() === 0);
  });

  test("log goes to stdout and error to stderr — a headless box's only two channels", async () => {
    const { makeSystemIo } = await import("./main");
    const io = makeSystemIo({ siteJson: "/tmp/site.json", configDir: "/tmp" });
    const seen: Array<[string, string]> = [];
    const realLog = console.log;
    const realError = console.error;
    console.log = (line: string) => void seen.push(["out", line]);
    console.error = (line: string) => void seen.push(["err", line]);
    try {
      io.log("hello");
      io.error("oh no");
    } finally {
      console.log = realLog;
      console.error = realError;
    }
    expect(seen).toEqual([
      ["out", "hello"],
      ["err", "oh no"],
    ]);
  });
});

describe("the failure paths a remote box actually hits", () => {
  test("a staging failure stops before committing or rebuilding", () => {
    const h = harness({}, (command) =>
      command.includes("add")
        ? { ok: false, output: "fatal: not a git repository" }
        : { ok: true, output: "" },
    );
    expect(run(["timezone", "Europe/Berlin"], h.io)).toBe(1);
    expect(h.errs.join("\n")).toContain("not a git repository");
    expect(joined(h.runs).some((c) => c.includes("commit"))).toBe(false);
    expect(joined(h.runs).some((c) => c.includes("nixos-rebuild"))).toBe(false);
  });

  test("a reset that cannot stop tailscaled exits 1 before wiping anything", () => {
    const h = harness({}, (command) => ({
      ok: !(command.includes("stop") && command.includes("tailscaled")),
      output: "Job for tailscaled.service failed",
    }));
    expect(run(["tailscale", "reset"], h.io)).toBe(1);
    expect(joined(h.runs).some((c) => c.includes("/var/lib/tailscale"))).toBe(false);
  });

  test("a reset that cannot restart tailscaled exits 1 and says so", () => {
    const h = harness({}, (command) => ({
      ok: !(command.includes("start") && command.includes("tailscaled")),
      output: "unit not found",
    }));
    expect(run(["tailscale", "reset"], h.io)).toBe(1);
    expect(h.errs.join("\n")).toContain("could not start tailscaled");
  });

  test("a reset whose login page does not come back still succeeds, and says which part did not", () => {
    const h = harness({}, (command) => ({
      ok: !command.includes("tailscale-web"),
      output: "Unit tailscale-web.service not found.",
    }));
    expect(run(["tailscale", "reset"], h.io)).toBe(0);
    expect(h.out.join("\n")).toContain("tailscale-web did not start");
  });
});

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineProfile, metric, type ProfileData } from "@SunReye/inverter-core";

import { PROFILE_ROLES } from "./coverage";

// A real, full profile fixture (the published Deye SG05LP3), snapshotted so the
// CLI tests build/validate a realistic profile without depending on any inverter
// package. Source of truth: github.com/SunReye/SunReye-Official-Profiles.
import sampleProfile from "./__fixtures__/sample-profile.json";
import {
  cmdBuild,
  cmdCoverage,
  cmdInit,
  cmdReplay,
  cmdScaffold,
  cmdUpgrade,
  cmdValidate,
  flags,
} from "./cli-commands";

const deyeSg05lp3Data = sampleProfile as unknown as ProfileData;

const dir = mkdtempSync(join(tmpdir(), "profile-cli-"));

function writeFixture(name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

const validProfilePath = writeFixture("deye.json", JSON.stringify(deyeSg05lp3Data));
/**
 * Every renderable role mapped. The Deye fixture maps all but the `backup.*`
 * family: its load output *is* the house load, so it states the output through
 * `declares.backupOutput` (a v3 profile) or by being legacy, and never meters it
 * twice. A profile that separates the two — a critical-loads sub-panel — is what
 * 100 % coverage looks like, so that is what the coverage report is asserted on.
 */
const backupMetric = (key: string, addr: number, over: Record<string, unknown> = {}) => ({
  key,
  topic: key.replaceAll(".", "/"),
  label: key,
  unit: null,
  group: "backup",
  type: "U_WORD",
  addresses: [addr],
  scale: 1,
  access: "r",
  role: key,
  ...over,
});
const fullCoveragePath = writeFixture(
  "full-coverage.json",
  JSON.stringify({
    ...deyeSg05lp3Data,
    metrics: [
      ...deyeSg05lp3Data.metrics,
      backupMetric("backup.power", 60000, { unit: "W" }),
      backupMetric("backup.phase.power", 60001, { unit: "W", index: 1 }),
      backupMetric("backup.phase.voltage", 60002, { unit: "V", index: 1 }),
      backupMetric("backup.energy.today", 60003, { unit: "kWh" }),
      backupMetric("backup.energy.total", 60004, { unit: "kWh" }),
      // Roles a hybrid may not report but a string inverter does: per-MPPT yield
      // and the grid frequency.
      backupMetric("grid.frequency", 60005, { unit: "Hz", group: "grid" }),
      backupMetric("pv.string.energy.today", 60006, { unit: "kWh", group: "pv", index: 1 }),
      backupMetric("pv.string.energy.total", 60007, { unit: "kWh", group: "pv", index: 1 }),
      // Phase currents on every AC output, the islanded output's frequency and
      // the generator's lifetime total — the Deye maps none of them.
      backupMetric("backup.phase.current", 60008, { unit: "A", index: 1 }),
      backupMetric("backup.frequency", 60009, { unit: "Hz" }),
      backupMetric("load.phase.current", 60010, { unit: "A", group: "load", index: 1 }),
      backupMetric("generator.phase.current", 60011, { unit: "A", group: "generator", index: 1 }),
      backupMetric("generator.energy.total", 60012, { unit: "kWh", group: "generator" }),
    ],
  }),
);
const brokenProfilePath = writeFixture(
  "broken.json",
  JSON.stringify({
    schemaVersion: 1,
    id: "x",
    name: "X",
    manufacturer: "X",
    version: "1",
    metrics: [],
  }),
);
// A valid profile that maps only two of the renderable roles, so the coverage
// report has something to report as unmapped (the Deye fixture maps all of them).
const sparseProfilePath = writeFixture(
  "sparse.json",
  JSON.stringify(
    defineProfile({
      id: "sparse",
      name: "Sparse",
      manufacturer: "ACME",
      version: "1.0.0",
      metrics: [
        metric("battery/soc", {
          label: "Battery SOC",
          group: "battery",
          unit: "%",
          role: "battery.soc",
          addr: 588,
          // Bounded, so this fixture trips no semantic lint: it isolates the
          // coverage warnings from the lint gate.
          range: { min: 0, max: 100 },
        }),
        metric("dc/pv1/power", {
          label: "PV1 Power",
          group: "solar",
          unit: "W",
          role: "pv.string.power",
          index: 1,
          addr: 672,
        }),
      ],
    }),
  ),
);
// A valid profile whose one extra metric is read-only, unitless, roleless and
// kind-less — the shape that silently falls through to `measurement` (#124).
const unresolvableKindPath = writeFixture(
  "unresolvable-kind.json",
  JSON.stringify(
    defineProfile({
      id: "unresolvable",
      name: "Unresolvable",
      manufacturer: "ACME",
      version: "1.0.0",
      metrics: [
        metric("battery/soc", {
          label: "Battery SOC",
          group: "battery",
          unit: "%",
          role: "battery.soc",
          addr: 588,
        }),
        metric("ac/relay_status", { label: "Relays", group: "inverter", addr: 552 }),
      ],
    }),
  ),
);
// The same profile with the two escape hatches the lint accepts: a mapped role
// on one metric, an explicit `kind` on the other.
const resolvableKindPath = writeFixture(
  "resolvable-kind.json",
  JSON.stringify(
    defineProfile({
      id: "resolvable",
      name: "Resolvable",
      manufacturer: "ACME",
      version: "1.0.0",
      metrics: [
        metric("ac/relay_status", {
          label: "Relays",
          group: "inverter",
          addr: 552,
          role: "inverter.relay_status",
          enumLabels: { 0: "Open", 1: "Closed" },
        }),
        metric("inverter/mystery", {
          label: "Mystery",
          group: "inverter",
          addr: 553,
          kind: "status",
          enumLabels: { 0: "Off", 1: "On" },
        }),
      ],
    }),
  ),
);
// The published Deye profile as it was before #124 fixed it: `ac.relay_status`
// read-only, unitless, roleless and kind-less. The regression proof that the
// lint catches a real shipped mistake, not a hypothetical.
const deyeBeforeFixPath = writeFixture(
  "deye-pre-124.json",
  JSON.stringify({
    ...deyeSg05lp3Data,
    metrics: deyeSg05lp3Data.metrics.map((m) =>
      m.key === "ac.relay_status"
        ? { ...m, role: undefined, kind: undefined, enumLabels: undefined }
        : m,
    ),
  }),
);
const csvPath = writeFixture(
  "regs.csv",
  [
    "topic,label,unit,group,addr,type,scale,access",
    "battery/soc,Battery SOC,%,battery,588,U_WORD,1,r",
    "total_energy,Total Production,kWh,inverter,534|535,U_DWORD,0.1,r",
  ].join("\n"),
);

/** Capture stdout/stderr lines and turn `process.exit` into a throw. */
function captureIo() {
  const out: string[] = [];
  const err: string[] = [];
  const spies = [
    spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      out.push(a.join(" "));
    }),
    spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      err.push(a.join(" "));
    }),
    spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never),
  ];
  return { out, err, restore: () => spies.forEach((s) => s.mockRestore()) };
}

let io: ReturnType<typeof captureIo> | undefined;
afterEach(() => io?.restore());

describe("flags", () => {
  test("parses --flag value pairs and tolerates a trailing flag", () => {
    expect(flags(["--id", "x", "--name", "N", "--version"])).toEqual({
      id: "x",
      name: "N",
      version: "",
    });
    expect(flags([])).toEqual({});
  });
});

describe("cmdValidate", () => {
  test("accepts a valid profile", async () => {
    io = captureIo();
    await cmdValidate(validProfilePath);
    expect(io.out.join("\n")).toContain("valid profile");
  });

  test("exits 1 with issues for a broken profile", async () => {
    io = captureIo();
    await expect(cmdValidate(brokenProfilePath)).rejects.toThrow("exit 1");
    expect(io.err.join("\n")).toContain("is invalid");
  });

  test("exits with usage when no path given", async () => {
    io = captureIo();
    await expect(cmdValidate(undefined)).rejects.toThrow("exit 1");
    expect(io.err.join("\n")).toContain("usage:");
  });

  test("reports a half-written file as bad JSON instead of crashing", async () => {
    // A truncated profile (interrupted write, bad merge) must fail the same way
    // every other error does: `error: …` on stderr and exit 1, no stack trace.
    const truncated = writeFixture("truncated.json", '{ "schemaVersion": 1, "id": "half');
    io = captureIo();
    await expect(cmdValidate(truncated)).rejects.toThrow("exit 1");
    expect(io.err.join("\n")).toContain(`error: ${truncated} is not valid JSON`);
  });
});

describe("cmdValidate kind lint", () => {
  test("warns about a read-only, unitless, roleless, kind-less metric, naming the key", async () => {
    io = captureIo();
    await cmdValidate(unresolvableKindPath);
    const out = io.out.join("\n");
    expect(out).toContain("ac.relay_status");
    expect(out).toContain("kind");
  });

  test("stays quiet when the kind comes from a mapped role or an explicit field", async () => {
    io = captureIo();
    await cmdValidate(resolvableKindPath);
    expect(io.out.join("\n")).not.toContain("ac.relay_status");
  });

  test("fires on the pre-fix Deye profile's ac.relay_status", async () => {
    io = captureIo();
    await cmdValidate(deyeBeforeFixPath);
    expect(io.out.join("\n")).toContain("ac.relay_status");
  });

  test("the shipped Deye profile's ac.relay_status is marked, so it is not flagged", async () => {
    io = captureIo();
    await cmdValidate(validProfilePath);
    const out = io.out.join("\n");
    expect(out).toContain("valid profile");
    // Other roleless metrics in that profile still warn — this key must not.
    expect(out).not.toContain("ac.relay_status");
  });

  test("--strict turns the warning into a gate", async () => {
    io = captureIo();
    await expect(cmdValidate(unresolvableKindPath, { strict: "" })).rejects.toThrow("exit 1");
    expect(io.err.join("\n")).toContain("ac.relay_status");
  });
});

describe("cmdCoverage", () => {
  test("prints the role-coverage report for a valid profile", async () => {
    io = captureIo();
    await cmdCoverage(validProfilePath);
    expect(io.out.join("\n")).toContain("Role coverage:");
  });

  test("suggests sumOf for a sum that covers an indexed role group", async () => {
    io = captureIo();
    // The Deye base's dc.total_power sums exactly the pv.string.power group.
    await cmdCoverage(validProfilePath);
    const out = io.out.join("\n");
    expect(out).toContain("Optimization hints:");
    expect(out).toContain('sumOf({ role: "pv.string.power" })');
  });

  test("lists the unmapped roles grouped by area, marking the indexed ones", async () => {
    io = captureIo();
    await cmdCoverage(sparseProfilePath);
    const out = io.out.join("\n");

    expect(out).toContain(`Role coverage: 2/${PROFILE_ROLES.length} canonical roles mapped`);
    expect(out).toContain("Unmapped roles (these UI areas render empty):");
    // Grouped under the leading segment, in catalog order, `[]` on the roles
    // that need one metric per string/phase.
    expect(out).toContain("  pv: pv.string.voltage[], pv.string.current[], pv.total.power");
    expect(out).toContain("  grid: grid.power, grid.frequency, grid.phase.voltage[]");
    // The two roles the profile does map are absent from the unmapped list.
    // No other canonical role has these as a substring, so a bare `not.toContain`
    // is the strict assertion (a trailing comma would pass on a group-final role).
    expect(out).not.toContain("battery.soc");
    expect(out).not.toContain("pv.string.power[]");
  });

  test("says so only when every renderable role is mapped", async () => {
    io = captureIo();
    await cmdCoverage(sparseProfilePath);
    expect(io.out.join("\n")).not.toContain("every renderable role is mapped");

    io.restore();
    io = captureIo();
    await cmdCoverage(fullCoveragePath);
    expect(io.out.join("\n")).toContain("✓ every renderable role is mapped");
  });

  test("prints no optimization hints for a profile without hand-listed sums", async () => {
    io = captureIo();
    await cmdCoverage(sparseProfilePath);
    expect(io.out.join("\n")).not.toContain("Optimization hints");
  });

  test("refuses an invalid profile before reporting coverage", async () => {
    io = captureIo();
    await expect(cmdCoverage(brokenProfilePath)).rejects.toThrow("exit 1");
    expect(io.err.join("\n")).toContain("fix validation first");
  });

  test("exits when the file does not exist", async () => {
    io = captureIo();
    await expect(cmdCoverage(join(dir, "missing.json"))).rejects.toThrow("exit 1");
    expect(io.err.join("\n")).toContain("file not found");
  });
});

describe("cmdScaffold", () => {
  test("emits a scaffolded profile as JSON on stdout", async () => {
    io = captureIo();
    await cmdScaffold(csvPath, { id: "scaffolded", name: "S", manufacturer: "ACME" });
    const data = JSON.parse(io.out.join("\n")) as {
      id: string;
      version: string;
      metrics: unknown[];
    };
    expect(data.id).toBe("scaffolded");
    expect(data.version).toBe("0.1.0"); // default when --version omitted
    expect(data.metrics).toHaveLength(2);
  });

  test("requires id, name, and manufacturer", async () => {
    io = captureIo();
    await expect(cmdScaffold(csvPath, { id: "x" })).rejects.toThrow("exit 1");
    expect(io.err.join("\n")).toContain("requires --id");
  });
});

describe("cmdBuild", () => {
  // A code-defined entry module: named export, wrapped export with description,
  // and a default-export array — all shapes cmdBuild should pick up.
  const modulePath = writeFixture(
    "repo-entry.ts",
    [
      `const base = ${JSON.stringify(deyeSg05lp3Data)};`,
      `export const one = { ...base, id: "one" };`,
      `export const two = { profile: { ...base, id: "two" }, description: "second" };`,
      `export default [{ ...base, id: "three" }];`,
    ].join("\n"),
  );

  test("builds index.json + profile files from a module and a json file", async () => {
    io = captureIo();
    const out = join(dir, "repo-out");
    await cmdBuild([modulePath, validProfilePath], { out, name: "My Repo" });

    const index = JSON.parse(await Bun.file(join(out, "index.json")).text()) as {
      name: string;
      profiles: { id: string; path: string; description?: string }[];
    };
    expect(index.name).toBe("My Repo");
    expect(index.profiles.map((p) => p.id)).toEqual([deyeSg05lp3Data.id, "one", "three", "two"]);
    expect(index.profiles.find((p) => p.id === "two")?.description).toBe("second");
    for (const entry of index.profiles) {
      expect(await Bun.file(join(out, entry.path)).exists()).toBe(true);
    }
    expect(io.out.join("\n")).toContain("wrote 4 profile(s)");
  });

  test("fails the build on duplicate ids across entries", async () => {
    io = captureIo();
    await expect(
      cmdBuild([validProfilePath, validProfilePath], { out: join(dir, "dupe-out") }),
    ).rejects.toThrow("exit 1");
    expect(io.err.join("\n")).toContain("duplicate profile id");
  });

  test("requires --out and at least one entry", async () => {
    io = captureIo();
    await expect(cmdBuild([], {})).rejects.toThrow("exit 1");
    expect(io.err.join("\n")).toContain("usage: profile build");

    io.restore();
    io = captureIo();
    await expect(cmdBuild([modulePath], {})).rejects.toThrow("exit 1");
    expect(io.err.join("\n")).toContain("requires --out");
  });

  test("picks up the export the authoring builders emit, whatever version that is", async () => {
    io = captureIo();
    const entry = writeFixture(
      "v2-entry.ts",
      `export const p = ${JSON.stringify(
        defineProfile({
          id: "v2-one",
          name: "V2",
          manufacturer: "ACME",
          version: "1.0.0",
          metrics: [
            metric("battery/soc", {
              label: "Battery SOC",
              group: "battery",
              unit: "%",
              role: "battery.soc",
              addr: 588,
              range: { min: 0, max: 100 },
            }),
          ],
        }),
      )};`,
    );
    const out = join(dir, "v2-out");
    await cmdBuild([entry], { out });
    const index = JSON.parse(await Bun.file(join(out, "index.json")).text()) as {
      profiles: { id: string }[];
    };
    expect(index.profiles.map((p) => p.id)).toEqual(["v2-one"]);
  });

  test("fails when a module exports no profiles", async () => {
    io = captureIo();
    const empty = writeFixture("no-profiles.ts", "export const x = 1;");
    await expect(cmdBuild([empty], { out: join(dir, "empty-out") })).rejects.toThrow("exit 1");
    expect(io.err.join("\n")).toContain("no profiles exported");
  });

  test("auto-bumps a changed profile against the previous build in --out", async () => {
    const out = join(dir, "versioned-out");
    const v1 = writeFixture("v1.json", JSON.stringify({ ...deyeSg05lp3Data, version: "1.0.0" }));
    io = captureIo();
    await cmdBuild([v1], { out });
    io.restore();

    // Rebuild the same id with changed content (renamed) into the same out dir.
    const v2 = writeFixture(
      "v2.json",
      JSON.stringify({ ...deyeSg05lp3Data, version: "1.0.0", name: "Renamed" }),
    );
    io = captureIo();
    await cmdBuild([v2], { out });

    const published = JSON.parse(
      await Bun.file(join(out, `profiles/${deyeSg05lp3Data.id}.json`)).text(),
    ) as { version: string; name: string };
    expect(published.version).toBe("1.0.1");
    expect(io.out.join("\n")).toContain("bumped from 1.0.0");
  });

  test("bumps a changed profile by the level --bump asks for", async () => {
    const out = join(dir, "minor-bump-out");
    const v1 = writeFixture(
      "minor-v1.json",
      JSON.stringify({ ...deyeSg05lp3Data, version: "1.2.3" }),
    );
    io = captureIo();
    await cmdBuild([v1], { out });
    io.restore();

    const v2 = writeFixture(
      "minor-v2.json",
      JSON.stringify({ ...deyeSg05lp3Data, version: "1.2.3", name: "Renamed" }),
    );
    io = captureIo();
    await cmdBuild([v2], { out, bump: "minor" });

    const published = JSON.parse(
      await Bun.file(join(out, `profiles/${deyeSg05lp3Data.id}.json`)).text(),
    ) as { version: string };
    expect(published.version).toBe("1.3.0");
    expect(io.out.join("\n")).toContain("bumped from 1.2.3");
  });

  test("keeps the version of a profile that did not change since the last build", async () => {
    const out = join(dir, "unchanged-out");
    io = captureIo();
    await cmdBuild([validProfilePath], { out });
    io.restore();

    io = captureIo();
    await cmdBuild([validProfilePath], { out });
    const published = JSON.parse(
      await Bun.file(join(out, `profiles/${deyeSg05lp3Data.id}.json`)).text(),
    ) as { version: string };
    expect(published.version).toBe(deyeSg05lp3Data.version);
    expect(io.out.join("\n")).toContain("(unchanged)");
    expect(io.out.join("\n")).not.toContain("auto-bumped");
  });

  test("treats an unreadable previous build as no previous version", async () => {
    const out = join(dir, "corrupt-prior-out");
    // A half-written prior file, a JSON file that is not a profile, and a
    // non-JSON stray: none of them may crash the build or bump anything.
    await Bun.write(join(out, "profiles", `${deyeSg05lp3Data.id}.json`), '{ "id": "deye-');
    await Bun.write(join(out, "profiles", "notes.json"), '{"note":"not a profile"}');
    await Bun.write(join(out, "profiles", "README.md"), "# ignored");

    io = captureIo();
    await cmdBuild([validProfilePath], { out });
    const published = JSON.parse(
      await Bun.file(join(out, `profiles/${deyeSg05lp3Data.id}.json`)).text(),
    ) as { version: string };
    expect(published.version).toBe(deyeSg05lp3Data.version); // republished as-is
    expect(io.out.join("\n")).toContain("(new)");
  });

  test("takes one profile once when a module exports the same object several ways", async () => {
    const aliased = writeFixture(
      "aliased-entry.ts",
      [
        `const solo = { ...${JSON.stringify(deyeSg05lp3Data)}, id: "solo" };`,
        `export const named = solo;`,
        `export const wrapped = { profile: solo, description: "same object" };`,
        `export default [solo];`,
        `export const notAProfile = { id: "nope", metrics: "x" };`,
        `export const nothing = null;`,
      ].join("\n"),
    );
    io = captureIo();
    const out = join(dir, "aliased-out");
    await cmdBuild([aliased], { out });

    const index = JSON.parse(await Bun.file(join(out, "index.json")).text()) as {
      profiles: { id: string }[];
    };
    // Without identity dedupe this would fail the build as a duplicate id.
    expect(index.profiles.map((p) => p.id)).toEqual(["solo"]);
  });

  test("a truncated entry file fails the build with a JSON error, not a stack trace", async () => {
    const truncated = writeFixture("truncated-entry.json", '[{"schemaVersion": 1,');
    io = captureIo();
    await expect(cmdBuild([truncated], { out: join(dir, "truncated-out") })).rejects.toThrow(
      "exit 1",
    );
    expect(io.err.join("\n")).toContain("is not valid JSON");
  });

  test("reports every validation issue when an entry is not a valid profile", async () => {
    io = captureIo();
    await expect(
      cmdBuild([brokenProfilePath], { out: join(dir, "invalid-entry-out") }),
    ).rejects.toThrow("exit 1");
    const err = io.err.join("\n");
    expect(err).toContain("✗ repo build failed:");
    expect(err).toContain("•");
    expect(existsSync(join(dir, "invalid-entry-out", "index.json"))).toBe(false);
  });

  test("rejects an invalid --bump level", async () => {
    io = captureIo();
    await expect(
      cmdBuild([validProfilePath], { out: join(dir, "bad-bump-out"), bump: "huge" }),
    ).rejects.toThrow("exit 1");
    expect(io.err.join("\n")).toContain('invalid --bump "huge"');
  });
});

describe("cmdInit", () => {
  // Non-interactive deps: never touch stdin, record any spawned commands.
  const silent = () => {
    const commands: string[][] = [];
    return {
      commands,
      deps: {
        prompt: () => "",
        confirm: () => false,
        run: async (command: string[]) => {
          commands.push(command);
          return true;
        },
        sdkVersion: "9.9.9",
      },
    };
  };

  test("scaffolds the project layout from flags without prompting", async () => {
    io = captureIo();
    const out = join(dir, "init-flags");
    const { commands, deps } = silent();
    await cmdInit(
      out,
      {
        pkg: "my-profiles",
        id: "acme-hybrid",
        manufacturer: "Acme",
        install: "false",
        git: "false",
      },
      deps,
    );

    for (const rel of ["package.json", "tsconfig.json", "src/profiles.ts", ".gitignore"]) {
      expect(existsSync(join(out, rel))).toBe(true);
    }
    const pkg = JSON.parse(await Bun.file(join(out, "package.json")).text()) as {
      name: string;
      devDependencies: Record<string, string>;
    };
    expect(pkg.name).toBe("my-profiles");
    expect(pkg.devDependencies["@sunreye/profile-sdk"]).toBe("^9.9.9");
    expect(commands).toEqual([]); // install/git disabled
    expect(io.out.join("\n")).toContain("scaffolded profile project");
  });

  test("runs bun install and git init when confirmed", async () => {
    io = captureIo();
    const out = join(dir, "init-confirm");
    const commands: string[][] = [];
    await cmdInit(
      out,
      { id: "x", manufacturer: "X" },
      {
        prompt: () => "",
        confirm: () => true,
        run: async (command: string[]) => {
          commands.push(command);
          return true;
        },
        sdkVersion: "1.0.0",
      },
    );
    expect(commands).toEqual([
      ["bun", "install"],
      ["git", "init"],
    ]);
  });

  test("reports a failed install or git init instead of aborting the scaffold", async () => {
    io = captureIo();
    const out = join(dir, "init-step-fails");
    await cmdInit(
      out,
      { id: "x", manufacturer: "X" },
      {
        prompt: () => "",
        confirm: () => true,
        run: async () => false,
        sdkVersion: "1.0.0",
      },
    );
    const log = io.out.join("\n");
    expect(log).toContain("⚠ bun install failed — run it yourself");
    expect(log).toContain("⚠ git init failed");
    // The scaffold itself still stands and the closing hint is still printed.
    expect(existsSync(join(out, "package.json"))).toBe(true);
    expect(log).toContain("Next: cd");
  });

  test("skips git init when the target is already a repository", async () => {
    io = captureIo();
    const out = join(dir, "init-existing-git");
    await Bun.write(join(out, ".git", "HEAD"), "ref: refs/heads/main\n");
    const commands: string[][] = [];
    await cmdInit(
      out,
      { id: "x", manufacturer: "X", install: "false", git: "" },
      {
        prompt: () => "",
        confirm: () => true,
        run: async (command: string[]) => {
          commands.push(command);
          return true;
        },
        sdkVersion: "1.0.0",
      },
    );
    expect(commands).toEqual([]); // never re-runs git init over an existing repo
    expect(io.out.join("\n")).toContain("git repository already initialized — skipping");
  });

  test("asks for the missing values and takes the shown default on a blank answer", async () => {
    const asked: string[] = [];
    const promptSpy = spyOn(globalThis, "prompt").mockImplementation(((message: string) => {
      asked.push(message);
      if (message.startsWith("Package name")) return "chosen-profiles";
      if (message.startsWith("First profile id")) return "acme-hybrid";
      return ""; // blank → the shown default, and yes for the Y/n steps
    }) as never);
    io = captureIo();
    const out = join(dir, "init-prompted");
    const commands: string[][] = [];
    try {
      await cmdInit(
        out,
        {},
        {
          run: async (command: string[]) => {
            commands.push(command);
            return true;
          },
          sdkVersion: "1.0.0",
        },
      );
    } finally {
      promptSpy.mockRestore();
    }

    const pkg = JSON.parse(await Bun.file(join(out, "package.json")).text()) as {
      name: string;
      scripts: { build: string };
    };
    expect(pkg.name).toBe("chosen-profiles");
    // Repo name and profile display name fall back to the offered defaults.
    expect(pkg.scripts.build).toContain('--name "chosen-profiles"');
    expect(pkg.scripts.build).not.toContain("--maintainer"); // blank maintainer stays absent
    expect(await Bun.file(join(out, "src/profiles.ts")).text()).toContain('"Acme Hybrid"');
    expect(asked.some((m) => m.startsWith("Maintainer (optional)"))).toBe(true);
    // A blank answer to a (Y/n) question keeps the default: both steps run.
    expect(commands).toEqual([
      ["bun", "install"],
      ["git", "init"],
    ]);
  });

  test("declines the follow-up steps when the answer is no", async () => {
    const promptSpy = spyOn(globalThis, "prompt").mockImplementation(((message: string) => {
      if (message.includes("(Y/n)")) return "n";
      if (message.startsWith("Maintainer")) return null; // user hit ctrl-D
      return "";
    }) as never);
    io = captureIo();
    const out = join(dir, "init-declined");
    const commands: string[][] = [];
    try {
      await cmdInit(
        out,
        {},
        {
          run: async (command: string[]) => {
            commands.push(command);
            return true;
          },
          sdkVersion: "1.0.0",
        },
      );
    } finally {
      promptSpy.mockRestore();
    }

    expect(commands).toEqual([]);
    const pkg = JSON.parse(await Bun.file(join(out, "package.json")).text()) as { name: string };
    expect(pkg.name).toBe("init-declined"); // blank answer → the directory name
    expect(await Bun.file(join(out, "src/profiles.ts")).text()).toContain('"my-inverter"');
  });

  test("runs the real command for a step when no runner is injected", async () => {
    io = captureIo();
    const out = join(dir, "init-real-git");
    // --yes skips the prompts, --git forces the step on, --install keeps it off,
    // so the only thing spawned is a local `git init` (its own output is
    // inherited, which is why this test is noisy).
    await cmdInit(out, { yes: "", id: "x", manufacturer: "X", install: "false", git: "" });
    expect(existsSync(join(out, ".git"))).toBe(true);
    expect(io.out.join("\n")).toContain("✓ git repository initialized");
  });

  test("refuses to overwrite an existing package.json", async () => {
    io = captureIo();
    const out = join(dir, "init-existing");
    await Bun.write(join(out, "package.json"), "{}");
    const { deps } = silent();
    await expect(cmdInit(out, { id: "x", manufacturer: "X" }, deps)).rejects.toThrow("exit 1");
    expect(io.err.join("\n")).toContain("refusing to overwrite");
  });
});

describe("cmdUpgrade", () => {
  test("refuses to run outside a project (no package.json)", async () => {
    io = captureIo();
    const out = join(dir, "upgrade-empty");
    await Bun.write(join(out, ".keep"), "");
    await expect(cmdUpgrade(out, {})).rejects.toThrow("exit 1");
    expect(io.err.join("\n")).toContain("no package.json");
  });

  test("creates the guide files, then reports them up to date on a re-run", async () => {
    const out = join(dir, "upgrade-fresh");
    await Bun.write(join(out, "package.json"), "{}");

    io = captureIo();
    await cmdUpgrade(out, {});
    expect(existsSync(join(out, "AGENTS.md"))).toBe(true);
    expect(readFileSync(join(out, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");
    expect(io.out.join("\n")).toContain("created");

    io.restore();
    io = captureIo();
    await cmdUpgrade(out, {});
    expect(io.out.join("\n")).toContain("up to date");
  });

  test("keeps an edited AGENTS.md unless --force", async () => {
    const out = join(dir, "upgrade-edited");
    await Bun.write(join(out, "package.json"), "{}");
    await Bun.write(join(out, "AGENTS.md"), "# my own guide\n");
    await Bun.write(join(out, "CLAUDE.md"), "@AGENTS.md\n");

    io = captureIo();
    await cmdUpgrade(out, {});
    expect(io.out.join("\n")).toContain("kept your edited copy");
    expect(readFileSync(join(out, "AGENTS.md"), "utf8")).toBe("# my own guide\n"); // untouched

    io.restore();
    io = captureIo();
    await cmdUpgrade(out, { force: "" });
    expect(readFileSync(join(out, "AGENTS.md"), "utf8")).toContain(
      "# Authoring SunReye inverter profiles",
    );
  });

  test("flags a CLAUDE.md that lacks the @AGENTS.md import without clobbering it", async () => {
    const out = join(dir, "upgrade-claude");
    await Bun.write(join(out, "package.json"), "{}");
    await Bun.write(join(out, "CLAUDE.md"), "# hand-written\n");

    io = captureIo();
    await cmdUpgrade(out, { force: "" });
    expect(io.out.join("\n")).toContain("needs a manual edit");
    expect(readFileSync(join(out, "CLAUDE.md"), "utf8")).toBe("# hand-written\n"); // preserved
  });
});

// A valid profile with battery metrics but no `battery.soc` — the whole battery
// section renders empty, and it used to publish cleanly (#75).
const batteryWithoutSocPath = writeFixture(
  "battery-no-soc.json",
  JSON.stringify(
    defineProfile({
      id: "no-soc",
      name: "No SOC",
      manufacturer: "ACME",
      version: "1.0.0",
      metrics: [
        metric("battery/power", {
          label: "Battery Power",
          group: "battery",
          unit: "W",
          type: "S_WORD",
          role: "battery.power",
          addr: 590,
          flow: { positive: "Charging", negative: "Discharging" },
        }),
      ],
    }),
  ),
);

describe("cmdValidate coverage warnings", () => {
  test("surfaces the unmapped renderable roles for a sparse profile and still exits 0", async () => {
    io = captureIo();
    await cmdValidate(sparseProfilePath);
    const out = io.out.join("\n");
    expect(out).toContain("valid profile");
    expect(out).toContain("grid.power"); // an unmapped renderable role, named
    expect(out).toContain("pv.total.power");
  });

  test("says nothing about unmapped roles for a profile that maps them all", async () => {
    io = captureIo();
    await cmdValidate(fullCoveragePath);
    expect(io.out.join("\n")).not.toContain("render empty");
  });

  test("surfaces the sumOf suggestion for a hand-listed sum", async () => {
    io = captureIo();
    await cmdValidate(validProfilePath);
    expect(io.out.join("\n")).toContain('sumOf({ role: "pv.string.power" })');
  });

  test("coverage findings alone never fail the command, even under --strict", async () => {
    // Only schema failure and semantic lints gate; an unmapped role is advice.
    io = captureIo();
    await cmdValidate(sparseProfilePath, { strict: "" });
    expect(io.out.join("\n")).toContain("valid profile");
  });
});

describe("cmdValidate semantic lints", () => {
  test("warns about a percentage metric with no range, naming the key", async () => {
    io = captureIo();
    // The shipped Deye profile's TOU SOC settings carry `%` with no bounds.
    await cmdValidate(validProfilePath);
    const out = io.out.join("\n");
    expect(out).toContain("timeofuse.soc.1");
    expect(out).toContain("range");
  });

  test("--strict turns a semantic lint into a non-zero exit", async () => {
    io = captureIo();
    await expect(cmdValidate(validProfilePath, { strict: "" })).rejects.toThrow("exit 1");
    expect(io.err.join("\n")).toContain("timeofuse.soc.1");
  });
});

describe("cmdBuild required-role floor", () => {
  test("refuses a profile missing an explicitly required role, naming it", async () => {
    const out = join(dir, "require-out");
    io = captureIo();
    await expect(
      cmdBuild([sparseProfilePath], { out, require: "battery.soc,grid.power" }),
    ).rejects.toThrow("exit 1");
    const err = io.err.join("\n");
    expect(err).toContain("grid.power");
    expect(err).toContain("sparse");
    expect(err).not.toContain("battery.soc"); // that one is mapped
    expect(existsSync(join(out, "index.json"))).toBe(false);
  });

  test("builds when every required role is mapped", async () => {
    const out = join(dir, "require-ok-out");
    io = captureIo();
    await cmdBuild([sparseProfilePath], { out, require: "battery.soc" });
    expect(existsSync(join(out, "index.json"))).toBe(true);
  });

  test("refuses a battery profile with no battery.soc without any flag", async () => {
    const out = join(dir, "anchor-out");
    io = captureIo();
    await expect(cmdBuild([batteryWithoutSocPath], { out })).rejects.toThrow("exit 1");
    expect(io.err.join("\n")).toContain("battery.soc");
    expect(existsSync(join(out, "index.json"))).toBe(false);
  });

  test("rejects a --require name that is not a canonical role", async () => {
    io = captureIo();
    await expect(
      cmdBuild([validProfilePath], { out: join(dir, "bad-require-out"), require: "battery.sock" }),
    ).rejects.toThrow("exit 1");
    expect(io.err.join("\n")).toContain("battery.sock");
  });
});

describe("cmdReplay", () => {
  const tinyReplayPath = writeFixture(
    "tiny-replay.json",
    JSON.stringify(
      defineProfile({
        id: "tiny-replay",
        name: "Tiny Replay",
        manufacturer: "ACME",
        version: "1.0.0",
        metrics: [
          metric("battery/soc", {
            label: "Battery SOC",
            group: "battery",
            unit: "%",
            role: "battery.soc",
            addr: 10,
            range: { min: 0, max: 100 },
          }),
        ],
      }),
    ),
  );

  /** Write captures to disk and replay them against the tiny fixture profile. */
  function captures(...bodies: unknown[]): string[] {
    return bodies.map((b, i) =>
      writeFixture(
        `capture-${Math.random().toString(36).slice(2)}-${i}.json`,
        typeof b === "string" ? b : JSON.stringify(b),
      ),
    );
  }

  const holds = { profile: "tiny-replay", registers: { "10": 51 }, expect: { "battery.soc": 51 } };

  test("a capture whose expectations hold passes and reports what it checked", async () => {
    io = captureIo();
    await cmdReplay(captures(holds), { profile: tinyReplayPath });
    expect(io.out.join("\n")).toContain("battery.soc");
  });

  test("a mismatch exits non-zero naming the metric, the expected and the actual", async () => {
    io = captureIo();
    await expect(
      cmdReplay(captures({ ...holds, expect: { "battery.soc": 99 } }), { profile: tinyReplayPath }),
    ).rejects.toThrow("exit 1");
    const text = io.err.join("\n");
    expect(text).toContain("battery.soc");
    expect(text).toContain("99");
    expect(text).toContain("51");
  });

  test("one bad capture among several fails the whole run", async () => {
    io = captureIo();
    await expect(
      cmdReplay(captures(holds, { ...holds, expect: { "battery.soc": 7 } }), {
        profile: tinyReplayPath,
      }),
    ).rejects.toThrow("exit 1");
  });

  test("an expectation naming an unknown metric fails rather than being skipped", async () => {
    io = captureIo();
    await expect(
      cmdReplay(captures({ ...holds, expect: { "battery.nope": 1 } }), {
        profile: tinyReplayPath,
      }),
    ).rejects.toThrow("exit 1");
    expect(io.err.join("\n")).toContain("battery.nope");
  });

  test("an empty expect block is never a vacuous pass", async () => {
    io = captureIo();
    await expect(
      cmdReplay(captures({ ...holds, expect: {} }), { profile: tinyReplayPath }),
    ).rejects.toThrow("exit 1");
  });

  test("a malformed capture file is a readable error, not a stack trace", async () => {
    io = captureIo();
    await expect(cmdReplay(captures("{ not json"), { profile: tinyReplayPath })).rejects.toThrow(
      "exit 1",
    );
    expect(io.err.join("\n")).toMatch(/invalid capture file/i);
  });

  test("no capture path is a usage error", async () => {
    io = captureIo();
    await expect(cmdReplay([], {})).rejects.toThrow("exit 1");
    expect(io.err.join("\n")).toMatch(/usage: profile replay/);
  });

  test("a capture for a profile that is not installed and not given fails clearly", async () => {
    io = captureIo();
    await expect(cmdReplay(captures({ ...holds, profile: "no-such-profile" }), {})).rejects.toThrow(
      "exit 1",
    );
    expect(io.err.join("\n")).toContain("no-such-profile");
  });
});

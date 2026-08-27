import {
  ACTIVE_PROFILE_KEY,
  LEGACY_DEFAULT_SOURCE_URL,
  OFFICIAL_SOURCE_URL,
  PROFILE_SOURCES_KEY,
} from "@SunReye/db/profiles";
import { defineProfile, metric, tryGetProfile, unregisterProfile } from "@SunReye/inverter-core";
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ZodType } from "zod";

import { cleanGitEnv } from "./git-source";

/**
 * The catalog/install service is exercised against **real git** (see the
 * fixtures below) and the real profile registry; only the two persistence seams
 * are stood in for, because there is no database in the test process:
 *
 * - `@SunReye/db` — an in-memory `installed_profiles` table.
 * - `../settings/app-settings` — an in-memory `app_settings` key/value store
 *   with the real read semantics (validate the stored value, fall back to the
 *   default when it is missing or unreadable).
 *
 * Both spreads are load-bearing: `mock.module` is process-global and permanent,
 * so a factory returning only the exports THIS suite needs deletes the rest for
 * every file that runs afterwards. Override what is stubbed, keep the rest real.
 */

const TABLE_NAME = Symbol.for("drizzle:Name");
const tableOf = (table: unknown): string | undefined =>
  (table as Record<symbol, string | undefined>)[TABLE_NAME];

/** The bound value of a single-column drizzle `eq(column, value)` condition. */
function eqValue(condition: unknown): string | undefined {
  const chunks = (condition as { queryChunks?: { value?: unknown }[] }).queryChunks ?? [];
  for (const chunk of chunks) if (typeof chunk.value === "string") return chunk.value;
  return undefined;
}

interface InstalledRow {
  id: string;
  source: string;
  version: string;
  data: unknown;
  installedAt: Date;
}

const installedRows = new Map<string, InstalledRow>();
/** Reads of `installed_profiles` — one per `browseAvailable`, so a check counter. */
let selectCount = 0;
/** Armed to make the next read fail once (a database that went away mid-check). */
let selectFailure: Error | null = null;

const fakeDb = {
  select: () => ({
    from: (table: unknown) => {
      selectCount++;
      if (selectFailure) {
        const failure = selectFailure;
        selectFailure = null;
        return Promise.reject(failure);
      }
      // Any other table is simply empty — nothing else is seeded here.
      if (tableOf(table) !== "installed_profiles") return Promise.resolve([]);
      return Promise.resolve([...installedRows.values()]);
    },
  }),
  insert: (table: unknown) => ({
    values: (row: Omit<InstalledRow, "installedAt">) => ({
      onConflictDoUpdate: ({ set }: { set: Partial<InstalledRow> }) => {
        if (tableOf(table) === "installed_profiles") {
          const existing = installedRows.get(row.id);
          installedRows.set(
            row.id,
            existing ? { ...existing, ...set } : { ...row, installedAt: new Date() },
          );
        }
        return Promise.resolve();
      },
    }),
  }),
  delete: (table: unknown) => ({
    where: (condition: unknown) => {
      const id = eqValue(condition);
      if (tableOf(table) === "installed_profiles" && id !== undefined) installedRows.delete(id);
      return Promise.resolve();
    },
  }),
};

const realDb = await import("@SunReye/db");
// Snapshot BY VALUE, before the mock is installed: a module namespace is live,
// so afterwards `realDb.db` IS the fake and `() => realDb` would restore the
// stub. See the restore at the foot of the fixtures below.
const realDbExports = { ...realDb };
mock.module("@SunReye/db", () => ({ ...realDb, db: fakeDb }));

const settingsStore = new Map<string, unknown>();
let settingWrites = 0;

async function readSetting<T>(key: string, schema: ZodType<T>, fallback: T): Promise<T> {
  const stored = settingsStore.get(key);
  const parsed = stored === undefined ? null : schema.safeParse(stored);
  return parsed?.success ? parsed.data : fallback;
}

async function writeSetting<T>(key: string, value: T): Promise<void> {
  settingWrites++;
  settingsStore.set(key, structuredClone(value));
}

const realAppSettings = await import("../settings/app-settings");
const realAppSettingsExports = { ...realAppSettings }; // by value, before the mock
mock.module("../settings/app-settings", () => ({ ...realAppSettings, readSetting, writeSetting }));

// Both stubs are permanent otherwise: they stay installed for every file that
// loads after this one, and `app-settings` has its own unit suite that would
// then exercise the in-memory store above instead of the real reader. Hand the
// snapshots back once this file is done.
afterAll(() => {
  mock.module("@SunReye/db", () => ({ ...realDbExports }));
  mock.module("../settings/app-settings", () => ({ ...realAppSettingsExports }));
});

// `inverter.test.ts` permanently stubs this module's `dropLegacyDefaultSource`
// (mock.module is global and there is no unmock), so a plain `./profiles` import
// yields that stub whenever this file runs after it. The query suffix resolves
// to a fresh, unstubbed instance of the same file — coverage still attributes to
// it, and nothing else in the process shares its module state.
const profilesModule = "./profiles?unstubbed";
const {
  browseAvailable,
  dropLegacyDefaultSource,
  getProfileSources,
  getUpdateCheck,
  installProfile,
  listInstalled,
  setActiveProfile,
  setProfileSources,
  startUpdateChecks,
  stopUpdateChecks,
  uninstallProfile,
} = (await import(profilesModule)) as typeof import("./profiles");

// ---------------------------------------------------------------------------
// Fixtures: real git repositories, reached over https without a network.
//
// Stored sources must be public https URLs (`profileSourceSchema`), so a
// `file://` fixture can never reach `browseAvailable`. Instead each fixture repo
// is a local `git init` that a throwaway global git config rewrites an https URL
// onto (`url.<local>.insteadOf`), so the code under test clones and pulls for
// real — same transport code path, no network, no mocked git client.
// ---------------------------------------------------------------------------

const RUN = Math.random().toString(36).slice(2, 10);
let originsRoot: string;
let gitConfigFile: string;
let previousGitConfigGlobal: string | undefined;
const rewrites: string[] = [];
const clonedUrls: string[] = [];

const gitEnv = () => ({
  ...cleanGitEnv(process.env),
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
});

async function addRewrite(url: string, target: string): Promise<void> {
  rewrites.push(`[url "${target}"]\n\tinsteadOf = ${url}\n`);
  await writeFile(gitConfigFile, rewrites.join(""));
}

async function commitAll(dir: string, message: string): Promise<void> {
  const opts = { cwd: dir, env: gitEnv() } as const;
  await Bun.spawn(["git", "add", "-A"], opts).exited;
  await Bun.spawn(["git", "commit", "-m", message], opts).exited;
}

/** Write the repo's files and commit them. */
async function publish(dir: string, files: Record<string, string>): Promise<void> {
  for (const [path, contents] of Object.entries(files)) {
    await writeFile(join(dir, path), contents);
  }
  await commitAll(dir, "publish");
}

/** A git repo, served at an https URL the code under test can store as a source. */
async function makeOrigin(name: string, files: Record<string, string>): Promise<string> {
  const dir = join(originsRoot, name);
  await mkdir(join(dir, "profiles"), { recursive: true });
  await Bun.spawn(["git", "init", "-b", "main"], { cwd: dir, env: gitEnv() }).exited;
  await publish(dir, files);
  const url = `https://profiles.test/${RUN}/${name}`;
  await addRewrite(url, `file://${dir}`);
  clonedUrls.push(url);
  return url;
}

const profileJson = (id: string, name: string, manufacturer: string, version: string) =>
  JSON.stringify(
    defineProfile({
      id,
      name,
      manufacturer,
      version,
      metrics: [
        metric("battery/soc", {
          label: "SOC",
          unit: "%",
          group: "battery",
          addr: 100,
          role: "battery.soc",
        }),
      ],
    }),
  );

interface Entry {
  id: string;
  name: string;
  manufacturer: string;
  version: string;
  path: string;
}
const indexJson = (profiles: Entry[]) =>
  JSON.stringify({ name: "Fixture", maintainer: "tester", profiles });

/** Three profiles, listed out of order so the browse sort has something to do. */
const mainIndex = (sun10k: string, sun5k: string, zeta: string) =>
  indexJson([
    {
      id: "acme-sun-10k",
      name: "SUN-10K",
      manufacturer: "ACME",
      version: sun10k,
      path: "profiles/sun-10k.json",
    },
    {
      id: "zeta-one",
      name: "One",
      manufacturer: "Zeta",
      version: zeta,
      path: "profiles/zeta-one.json",
    },
    {
      id: "acme-sun-5k",
      name: "SUN-5K",
      manufacturer: "ACME",
      version: sun5k,
      path: "profiles/sun-5k.json",
    },
  ]);

let mainUrl: string;
let mainDir: string;
let quirksUrl: string;
let brokenUrl: string;
let unreachableUrl: string;
let installUrl: string;
let installDir: string;

beforeAll(async () => {
  originsRoot = await mkdtemp(join(tmpdir(), "sunreye-profile-origins-"));
  gitConfigFile = join(originsRoot, "gitconfig");
  await writeFile(gitConfigFile, "");
  previousGitConfigGlobal = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = gitConfigFile;

  mainUrl = await makeOrigin("main", {
    "index.json": mainIndex("1.0.0", "1.0.0", "1.0.0"),
    "profiles/sun-10k.json": profileJson("acme-sun-10k", "SUN-10K", "ACME", "1.0.0"),
    "profiles/sun-5k.json": profileJson("acme-sun-5k", "SUN-5K", "ACME", "1.0.0"),
    "profiles/zeta-one.json": profileJson("zeta-one", "One", "Zeta", "1.0.0"),
  });
  mainDir = join(originsRoot, "main");

  quirksUrl = await makeOrigin("quirks", {
    "index.json": indexJson([
      {
        id: "acme-mislabelled",
        name: "Mislabelled",
        manufacturer: "ACME",
        version: "1.0.0",
        path: "profiles/honest.json",
      },
      {
        id: "acme-garbage",
        name: "Garbage",
        manufacturer: "ACME",
        version: "1.0.0",
        path: "profiles/garbage.json",
      },
      {
        id: "acme-unparsable",
        name: "Unparsable",
        manufacturer: "ACME",
        version: "1.0.0",
        path: "profiles/unparsable.json",
      },
      {
        id: "acme-absent",
        name: "Absent",
        manufacturer: "ACME",
        version: "1.0.0",
        path: "profiles/absent.json",
      },
    ]),
    "profiles/honest.json": profileJson("acme-honest", "Honest", "ACME", "1.0.0"),
    "profiles/garbage.json": JSON.stringify({ id: "acme-garbage", name: "Garbage" }),
    "profiles/unparsable.json": "{ this is not json",
  });

  brokenUrl = await makeOrigin("broken", { "index.json": JSON.stringify({ name: "no profiles" }) });

  installUrl = await makeOrigin("install", {
    "index.json": indexJson([
      {
        id: "acme-inst",
        name: "Installable",
        manufacturer: "ACME",
        version: "1.0.0",
        path: "profiles/inst.json",
      },
    ]),
    "profiles/inst.json": profileJson("acme-inst", "Installable", "ACME", "1.0.0"),
  });
  installDir = join(originsRoot, "install");

  // Registered, but pointing at a directory that was never created: the clone
  // fails locally instead of resolving profiles.test on the network.
  unreachableUrl = `https://profiles.test/${RUN}/gone`;
  await addRewrite(unreachableUrl, `file://${join(originsRoot, "gone")}`);
  clonedUrls.push(unreachableUrl);
});

afterAll(async () => {
  if (previousGitConfigGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
  else process.env.GIT_CONFIG_GLOBAL = previousGitConfigGlobal;
  await rm(originsRoot, { recursive: true, force: true });
  // Clone caches are keyed by URL hash (see git-source `cacheDirFor`).
  for (const url of clonedUrls) {
    const hash = createHash("sha256").update(url).digest("hex").slice(0, 16);
    await rm(join(tmpdir(), "sunreye-profile-repos", hash), { recursive: true, force: true });
  }
  for (const id of ["acme-inst", "acme-sun-10k", "acme-sun-5k", "zeta-one", "acme-honest"]) {
    unregisterProfile(id);
  }
});

beforeEach(() => {
  installedRows.clear();
  settingsStore.clear();
  settingWrites = 0;
  selectCount = 0;
  selectFailure = null;
});

/** Store a source list. The official source is disabled: it is a real remote. */
async function useSources(...urls: string[]): Promise<void> {
  await setProfileSources({
    sources: [{ url: OFFICIAL_SOURCE_URL, enabled: false }, ...urls.map((url) => ({ url }))],
  });
}

function seedInstalled(id: string, version: string, source = mainUrl): void {
  installedRows.set(id, {
    id,
    source,
    version,
    data: JSON.parse(profileJson(id, id, "ACME", version)),
    installedAt: new Date("2026-01-02T03:04:05.000Z"),
  });
}

describe("profile sources", () => {
  test("offers the official source on a fresh install with nothing stored", async () => {
    const { sources } = await getProfileSources();
    expect(sources).toEqual([
      { url: OFFICIAL_SOURCE_URL, label: "SunReye Official Profiles", enabled: true },
    ]);
  });

  test("falls back to the official source when the stored list is unreadable", async () => {
    settingsStore.set(PROFILE_SOURCES_KEY, { sources: "https://example.com/one.git" });
    const { sources } = await getProfileSources();
    expect(sources.map((s) => s.url)).toEqual([OFFICIAL_SOURCE_URL]);
  });

  test("keeps the official source that a user disabled disabled", async () => {
    await setProfileSources({ sources: [{ url: OFFICIAL_SOURCE_URL, enabled: false }] });
    const { sources } = await getProfileSources();
    expect(sources).toHaveLength(1);
    expect(sources[0]?.enabled).toBe(false);
  });

  test("recognises the official source written with a trailing .git", async () => {
    await setProfileSources({ sources: [{ url: `${OFFICIAL_SOURCE_URL}.git`, enabled: false }] });
    const { sources } = await getProfileSources();
    expect(sources).toHaveLength(1);
    expect(sources[0]?.enabled).toBe(false);
  });

  test("re-injects the official source when a write tries to remove it", async () => {
    const written = await setProfileSources({
      sources: [{ url: "https://example.com/community.git", label: "Community" }],
    });
    expect(written.sources.map((s) => s.url)).toEqual([
      OFFICIAL_SOURCE_URL,
      "https://example.com/community.git",
    ]);
    // Persisted, not just returned.
    const { sources } = await getProfileSources();
    expect(sources.map((s) => s.url)).toEqual([
      OFFICIAL_SOURCE_URL,
      "https://example.com/community.git",
    ]);
    expect(sources[1]?.enabled).toBe(true); // enabled unless the write says otherwise
  });

  test("rejects a source that is not a public https git URL", async () => {
    await expect(
      setProfileSources({ sources: [{ url: "ssh://git@example.com/x.git" }] }),
    ).rejects.toThrow();
    await expect(
      setProfileSources({ sources: [{ url: "file:///tmp/profiles" }] }),
    ).rejects.toThrow();
    await expect(setProfileSources({ sources: [{ url: "not a url" }] })).rejects.toThrow();
    expect(settingWrites).toBe(0);
  });
});

describe("dropLegacyDefaultSource", () => {
  test("drops the dead default source early builds seeded", async () => {
    await setProfileSources({
      sources: [{ url: LEGACY_DEFAULT_SOURCE_URL }, { url: "https://example.com/community.git" }],
    });
    await dropLegacyDefaultSource();
    const { sources } = await getProfileSources();
    expect(sources.map((s) => s.url)).toEqual([
      OFFICIAL_SOURCE_URL,
      "https://example.com/community.git",
    ]);
  });

  test("leaves a list that never held it untouched", async () => {
    await setProfileSources({ sources: [{ url: "https://example.com/community.git" }] });
    settingWrites = 0;
    await dropLegacyDefaultSource();
    expect(settingWrites).toBe(0);
  });

  test("is a no-op on a fresh install", async () => {
    await dropLegacyDefaultSource();
    expect(settingWrites).toBe(0);
    expect(settingsStore.has(PROFILE_SOURCES_KEY)).toBe(false);
  });
});

describe("active profile", () => {
  test("persists only the chosen id", async () => {
    expect(await setActiveProfile({ id: "acme-sun-5k", restartNow: true })).toEqual({
      id: "acme-sun-5k",
    });
    expect(settingsStore.get(ACTIVE_PROFILE_KEY)).toEqual({ id: "acme-sun-5k" });
  });

  test("refuses an empty or missing id", async () => {
    await expect(setActiveProfile({ id: "" })).rejects.toThrow();
    await expect(setActiveProfile({})).rejects.toThrow();
    expect(settingWrites).toBe(0);
  });
});

describe("installed profiles", () => {
  test("lists nothing before anything is installed", async () => {
    expect(await listInstalled()).toEqual([]);
  });

  test("reports the identity from the stored blob and the version from the row", async () => {
    installedRows.set("acme-sun-5k", {
      id: "acme-sun-5k",
      source: mainUrl,
      version: "1.0.0", // what was installed…
      data: JSON.parse(profileJson("acme-sun-5k", "SUN-5K", "ACME", "9.9.9")), // …blob says otherwise
      installedAt: new Date("2026-01-02T03:04:05.000Z"),
    });
    expect(await listInstalled()).toEqual([
      {
        id: "acme-sun-5k",
        name: "SUN-5K",
        manufacturer: "ACME",
        version: "1.0.0",
        source: mainUrl,
        installedAt: "2026-01-02T03:04:05.000Z",
      },
    ]);
  });
});

describe("browsing sources", () => {
  test("annotates every entry against the installed set", async () => {
    await useSources(mainUrl);
    seedInstalled("acme-sun-5k", "1.0.0");
    const { profiles, errors } = await browseAvailable();
    expect(errors).toEqual([]);
    const installed = profiles.find((p) => p.id === "acme-sun-5k");
    expect(installed).toMatchObject({
      source: mainUrl,
      installed: true,
      installedVersion: "1.0.0",
      updateAvailable: false,
      path: "profiles/sun-5k.json",
    });
    const untouched = profiles.find((p) => p.id === "zeta-one");
    expect(untouched?.installed).toBe(false);
    expect(untouched?.installedVersion).toBeUndefined();
    expect(untouched?.updateAvailable).toBe(false);
  });

  test("flags a semver-newer release in the repo as an update", async () => {
    await useSources(mainUrl);
    seedInstalled("acme-sun-10k", "0.9.0");
    const { profiles } = await browseAvailable();
    expect(profiles.find((p) => p.id === "acme-sun-10k")).toMatchObject({
      installedVersion: "0.9.0",
      updateAvailable: true,
    });
  });

  test("never offers a downgrade as an update", async () => {
    await useSources(mainUrl);
    seedInstalled("acme-sun-10k", "3.0.0");
    const { profiles } = await browseAvailable();
    expect(profiles.find((p) => p.id === "acme-sun-10k")?.updateAvailable).toBe(false);
  });

  test("skips disabled sources", async () => {
    await useSources(); // official only, and it is disabled
    expect(await browseAvailable()).toEqual({ profiles: [], errors: [] });
  });

  test("sorts by manufacturer then model, numerically, not by index order", async () => {
    await useSources(mainUrl);
    const { profiles } = await browseAvailable();
    expect(profiles.map((p) => `${p.manufacturer} ${p.name}`)).toEqual([
      "ACME SUN-5K",
      "ACME SUN-10K",
      "Zeta One",
    ]);
  });

  test("reports a source that cannot be cloned without failing the browse", async () => {
    await useSources(unreachableUrl, mainUrl);
    const { profiles, errors } = await browseAvailable();
    expect(errors).toHaveLength(1);
    expect(errors[0]?.source).toBe(unreachableUrl);
    expect(errors[0]?.error).toMatch(/git clone failed/);
    expect(profiles).toHaveLength(3); // the healthy source still browses
  });

  test("reports a source whose index is not a valid manifest", async () => {
    await useSources(brokenUrl, mainUrl);
    const { profiles, errors } = await browseAvailable();
    expect(errors).toHaveLength(1);
    expect(errors[0]?.source).toBe(brokenUrl);
    expect(errors[0]?.error).toMatch(/profiles/);
    expect(profiles).toHaveLength(3);
  });

  test("picks up a release published after the source was first cloned", async () => {
    await useSources(mainUrl);
    seedInstalled("acme-sun-10k", "1.0.0");
    expect((await browseAvailable()).profiles.find((p) => p.id === "acme-sun-10k")).toMatchObject({
      version: "1.0.0",
      updateAvailable: false,
    });

    await publish(mainDir, { "index.json": mainIndex("2.0.0", "1.0.0", "1.0.0") });

    expect((await browseAvailable()).profiles.find((p) => p.id === "acme-sun-10k")).toMatchObject({
      version: "2.0.0",
      updateAvailable: true,
    });

    await publish(mainDir, { "index.json": mainIndex("1.0.0", "1.0.0", "1.0.0") });
  });
});

describe("installing a profile", () => {
  test("persists the validated profile and registers it without a restart", async () => {
    expect(await installProfile(installUrl, "acme-inst")).toEqual({
      id: "acme-inst",
      version: "1.0.0",
    });
    expect(await listInstalled()).toEqual([
      {
        id: "acme-inst",
        name: "Installable",
        manufacturer: "ACME",
        version: "1.0.0",
        source: installUrl,
        installedAt: expect.any(String),
      },
    ]);
    expect(tryGetProfile("acme-inst")?.metrics[0]?.role).toBe("battery.soc");
  });

  test("replaces the stored row when a newer release is installed over it", async () => {
    await installProfile(installUrl, "acme-inst");
    const firstRow = installedRows.get("acme-inst");
    expect(firstRow).toBeDefined();
    // NaN if the row vanished, so the comparison below fails rather than passing
    // against a permissive fallback.
    const firstInstalledAt = firstRow?.installedAt.getTime() ?? Number.NaN;

    await publish(installDir, {
      "index.json": indexJson([
        {
          id: "acme-inst",
          name: "Installable",
          manufacturer: "ACME",
          version: "1.1.0",
          path: "profiles/inst.json",
        },
      ]),
      "profiles/inst.json": profileJson("acme-inst", "Installable", "ACME", "1.1.0"),
    });

    expect(await installProfile(installUrl, "acme-inst")).toEqual({
      id: "acme-inst",
      version: "1.1.0",
    });
    const installed = await listInstalled();
    expect(installed).toHaveLength(1); // upgraded in place, not duplicated
    expect(installed[0]?.version).toBe("1.1.0");
    // The upgrade re-stamps installedAt instead of carrying the first install's
    // over: strictly greater, so dropping that from the conflict-update `set` is
    // caught (the re-sync and re-clone between the two installs take ms).
    expect(installedRows.get("acme-inst")?.installedAt.getTime()).toBeGreaterThan(firstInstalledAt);

    await publish(installDir, {
      "index.json": indexJson([
        {
          id: "acme-inst",
          name: "Installable",
          manufacturer: "ACME",
          version: "1.0.0",
          path: "profiles/inst.json",
        },
      ]),
      "profiles/inst.json": profileJson("acme-inst", "Installable", "ACME", "1.0.0"),
    });
  });

  test("refuses an id the source's index does not list", async () => {
    await expect(installProfile(installUrl, "acme-nope")).rejects.toThrow(
      `profile "acme-nope" not found in ${installUrl}`,
    );
    expect(installedRows.size).toBe(0);
  });

  test("refuses a file whose declared id contradicts the index", async () => {
    await expect(installProfile(quirksUrl, "acme-mislabelled")).rejects.toThrow(
      /id mismatch: index lists "acme-mislabelled" but file declares "acme-honest"/,
    );
    expect(installedRows.size).toBe(0);
    expect(tryGetProfile("acme-honest")).toBeUndefined(); // nothing half-registered
  });

  test("refuses a profile file that is not a valid profile", async () => {
    await expect(installProfile(quirksUrl, "acme-garbage")).rejects.toThrow();
    expect(installedRows.size).toBe(0);
  });

  test("refuses a profile file that is not even JSON", async () => {
    await expect(installProfile(quirksUrl, "acme-unparsable")).rejects.toThrow();
    expect(installedRows.size).toBe(0);
  });

  test("refuses an index entry pointing at a file the repo does not contain", async () => {
    await expect(installProfile(quirksUrl, "acme-absent")).rejects.toThrow(
      /file not found in repo/,
    );
    expect(installedRows.size).toBe(0);
  });
});

describe("uninstalling a profile", () => {
  test("removes the row and drops it from the runtime registry", async () => {
    await installProfile(installUrl, "acme-inst");
    expect(tryGetProfile("acme-inst")).toBeDefined();

    await uninstallProfile("acme-inst");
    expect(await listInstalled()).toEqual([]);
    expect(tryGetProfile("acme-inst")).toBeUndefined();
  });

  test("is harmless for a profile that was never installed", async () => {
    seedInstalled("acme-sun-5k", "1.0.0");
    await uninstallProfile("acme-not-here");
    expect((await listInstalled()).map((p) => p.id)).toEqual(["acme-sun-5k"]);
  });
});

// ---------------------------------------------------------------------------
// The background update checker owns module-level state (last result, in-flight
// run, interval handle), so these run in order and drive the scheduler through
// stand-in globals rather than waiting out a 15-second boot delay.
// ---------------------------------------------------------------------------

interface Scheduled {
  fn: () => void;
  ms: number;
}
let timeouts: Scheduled[] = [];
let intervals: Scheduled[] = [];
let unrefs = 0;
let clearedIntervals: unknown[] = [];

/** Run `fn` with the timer globals captured instead of armed. */
function withCapturedTimers<T>(fn: () => T): T {
  const handle = () => ({
    unref: () => {
      unrefs++;
    },
  });
  const realTimeout = globalThis.setTimeout;
  const realInterval = globalThis.setInterval;
  const realClear = globalThis.clearInterval;
  globalThis.setTimeout = ((cb: () => void, ms: number) => {
    timeouts.push({ fn: cb, ms });
    return handle();
  }) as unknown as typeof globalThis.setTimeout;
  globalThis.setInterval = ((cb: () => void, ms: number) => {
    intervals.push({ fn: cb, ms });
    return handle();
  }) as unknown as typeof globalThis.setInterval;
  globalThis.clearInterval = ((h: unknown) => {
    clearedIntervals.push(h);
  }) as unknown as typeof globalThis.clearInterval;
  try {
    return fn();
  } finally {
    globalThis.setTimeout = realTimeout;
    globalThis.setInterval = realInterval;
    globalThis.clearInterval = realClear;
  }
}

/** Wait for the scheduled run to finish — it clones real repos, not microtasks. */
async function waitFor(done: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (done()) return;
    await Bun.sleep(5);
  }
  throw new Error(`timed out waiting for ${what}`);
}

describe("background update checks", () => {
  beforeEach(() => {
    timeouts = [];
    intervals = [];
    clearedIntervals = [];
    unrefs = 0;
  });

  test("reports that no check has run yet", () => {
    expect(getUpdateCheck()).toEqual({ checkedAt: null, updates: [], errors: [] });
  });

  test("checks shortly after boot and then every six hours, holding nothing open", () => {
    withCapturedTimers(() => startUpdateChecks());
    expect(timeouts.map((t) => t.ms)).toEqual([15_000]);
    expect(intervals.map((i) => i.ms)).toEqual([6 * 60 * 60 * 1000]);
    expect(unrefs).toBe(2); // neither timer may keep the process alive
    withCapturedTimers(() => stopUpdateChecks());
  });

  test("does not stack a second schedule when started twice", () => {
    withCapturedTimers(() => {
      startUpdateChecks();
      startUpdateChecks();
    });
    expect(timeouts).toHaveLength(1);
    expect(intervals).toHaveLength(1);
    withCapturedTimers(() => stopUpdateChecks());
  });

  test("caches the diff so the UI can read it without syncing", async () => {
    await useSources(mainUrl, brokenUrl);
    seedInstalled("acme-sun-5k", "0.1.0");
    seedInstalled("zeta-one", "1.0.0");

    withCapturedTimers(() => startUpdateChecks());
    const before = Date.now();
    timeouts[0]?.fn();
    await waitFor(() => getUpdateCheck().checkedAt !== null, "the first check");

    const result = getUpdateCheck();
    expect(result.updates).toEqual([
      {
        id: "acme-sun-5k",
        name: "SUN-5K",
        manufacturer: "ACME",
        source: mainUrl,
        installedVersion: "0.1.0",
        latestVersion: "1.0.0",
      },
    ]);
    expect(result.errors.map((e) => e.source)).toEqual([brokenUrl]);
    expect(new Date(result.checkedAt ?? "").getTime()).toBeGreaterThanOrEqual(before);
    withCapturedTimers(() => stopUpdateChecks());
  });

  test("shares one in-flight run between overlapping triggers", async () => {
    await useSources(mainUrl);
    withCapturedTimers(() => startUpdateChecks());
    selectCount = 0;

    const run = timeouts[0]?.fn;
    const tick = intervals[0]?.fn;
    const first = getUpdateCheck();
    run?.();
    tick?.(); // the interval fires while the manual run is still syncing
    await waitFor(() => getUpdateCheck() !== first, "the shared check");

    expect(selectCount).toBe(1);

    // …and once it has settled, the next trigger really does check again.
    const second = getUpdateCheck();
    tick?.();
    await waitFor(() => getUpdateCheck() !== second, "the second check");
    expect(selectCount).toBe(2);
    withCapturedTimers(() => stopUpdateChecks());
  });

  test("keeps the last good result when a check fails", async () => {
    await useSources(mainUrl);
    const previous = getUpdateCheck();
    selectFailure = new Error("database is gone");

    withCapturedTimers(() => startUpdateChecks());
    timeouts[0]?.fn();
    await waitFor(() => selectFailure === null, "the failing check");
    await Bun.sleep(5);

    expect(getUpdateCheck()).toBe(previous); // not clobbered with an empty result
    withCapturedTimers(() => stopUpdateChecks());
  });

  test("stops the interval on shutdown and can be started again", () => {
    withCapturedTimers(() => {
      startUpdateChecks();
      stopUpdateChecks();
      startUpdateChecks();
    });
    expect(clearedIntervals).toHaveLength(1);
    expect(intervals).toHaveLength(2); // the restart armed a fresh interval
    withCapturedTimers(() => stopUpdateChecks());
  });

  test("stopping a checker that never started is harmless", () => {
    withCapturedTimers(() => {
      stopUpdateChecks();
      stopUpdateChecks();
    });
    expect(clearedIntervals).toEqual([]);
  });
});

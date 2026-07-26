/**
 * Profile catalog + install service. Sits over the git-repo client
 * ({@link ./git-source}) and the `installed_profiles` table: browse profiles
 * across the configured git sources, download (validate + persist) one, and
 * manage the source list + active profile.
 *
 * Installing persists the validated `ProfileData` to the DB and registers it
 * into the runtime registry immediately, so it's listed/removable/selectable
 * without a restart. Only *activating* one is a boot concern (it shapes
 * boot-time routes/manifest/topics — see {@link @SunReye/db/profiles}).
 */

import { db } from "@SunReye/db";
import {
  ACTIVE_PROFILE_KEY,
  LEGACY_DEFAULT_SOURCE_URL,
  PROFILE_SOURCES_KEY,
  activeProfileSchema,
  mergeOfficialSource,
  profileSourcesSchema,
  type ProfileSources,
} from "@SunReye/db/profiles";
import { installedProfiles } from "@SunReye/db/schema/settings";
import {
  hydrateProfile,
  isNewerVersion,
  registerProfile,
  unregisterProfile,
  type ProfileData,
} from "@SunReye/inverter-core";
import { eq } from "drizzle-orm";
import { readSetting, writeSetting } from "./app-settings";
import { readIndex, readProfile, type RepoProfileEntry, syncRepo } from "./git-source";
import { log } from "./logging";

const logger = log("profiles");

/**
 * The configured git repo sources. The protected official source is merged in
 * on read, so it's always present even for installs predating it (back-fill
 * without a migration) — the user can disable it but not remove it.
 */
export async function getProfileSources(): Promise<ProfileSources> {
  const stored = await readSetting(
    PROFILE_SOURCES_KEY,
    profileSourcesSchema,
    profileSourcesSchema.parse({}),
  );
  return { sources: mergeOfficialSource(stored.sources) };
}

export async function setProfileSources(input: unknown): Promise<ProfileSources> {
  const parsed = profileSourcesSchema.parse(input);
  // Re-inject the official source if the write tried to drop it (disable-not-
  // remove); an incoming disabled entry is preserved by mergeOfficialSource.
  const merged = { sources: mergeOfficialSource(parsed.sources) };
  await writeSetting(PROFILE_SOURCES_KEY, merged);
  return merged;
}

/**
 * One-time seed migration: early builds seeded a hardcoded default source
 * ({@link LEGACY_DEFAULT_SOURCE_URL}) that points at a repo which never existed.
 * Drop it from already-deployed DBs so it doesn't linger as a dead, un-browsable
 * source. No-op once removed (and on fresh installs, which now start empty).
 */
export async function dropLegacyDefaultSource(): Promise<void> {
  const { sources } = await getProfileSources();
  const kept = sources.filter((s) => s.url !== LEGACY_DEFAULT_SOURCE_URL);
  if (kept.length === sources.length) return;
  await setProfileSources({ sources: kept });
  logger.info("dropped stale default profile source {url}", { url: LEGACY_DEFAULT_SOURCE_URL });
}

/** Persist the active profile id (takes effect on the next restart). */
export async function setActiveProfile(input: unknown): Promise<{ id: string }> {
  const parsed = activeProfileSchema.parse(input);
  await writeSetting(ACTIVE_PROFILE_KEY, parsed);
  return parsed;
}

export interface InstalledProfileSummary {
  id: string;
  name: string;
  manufacturer: string;
  version: string;
  source: string;
  installedAt: string;
}

/** Summaries of the DB-installed profiles (identity read from the stored blob). */
export async function listInstalled(): Promise<InstalledProfileSummary[]> {
  const rows = await db.select().from(installedProfiles);
  return rows.map((r) => {
    const data = r.data as ProfileData;
    return {
      id: r.id,
      name: data.name,
      manufacturer: data.manufacturer,
      version: r.version,
      source: r.source,
      installedAt: r.installedAt.toISOString(),
    };
  });
}

export interface AvailableProfile extends RepoProfileEntry {
  /** The git source this entry came from. */
  source: string;
  installed: boolean;
  installedVersion?: string;
  /** The repo offers a semver-newer release than what's installed. */
  updateAvailable: boolean;
}

/**
 * Clone/pull one source, read its `index.json`, and annotate every entry against
 * the installed set. Throws whatever the sync/parse failed with — the caller
 * turns that into a per-source error.
 */
async function syncSourceProfiles(
  sourceUrl: string,
  installedById: ReadonlyMap<string, { version: string }>,
): Promise<AvailableProfile[]> {
  const dir = await syncRepo(sourceUrl);
  const index = await readIndex(dir);
  return index.profiles.map((p) => {
    const installed = installedById.get(p.id);
    return {
      ...p,
      source: sourceUrl,
      installed: installed !== undefined,
      installedVersion: installed?.version,
      updateAvailable: installed !== undefined && isNewerVersion(installed.version, p.version),
    };
  });
}

/**
 * Browse every enabled source: clone/pull each repo, read its `index.json`, and
 * annotate each entry against the installed set. A source that fails to sync or
 * parse is reported in `errors` rather than failing the whole browse.
 */
export async function browseAvailable(): Promise<{
  profiles: AvailableProfile[];
  errors: { source: string; error: string }[];
}> {
  const { sources } = await getProfileSources();
  const rows = await db.select().from(installedProfiles);
  const installedById = new Map(rows.map((r) => [r.id, r]));

  const profiles: AvailableProfile[] = [];
  const errors: { source: string; error: string }[] = [];
  for (const src of sources) {
    if (!src.enabled) continue;
    try {
      profiles.push(...(await syncSourceProfiles(src.url, installedById)));
    } catch (error) {
      errors.push({
        source: src.url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  // Natural sort (numeric-aware) so e.g. "SUN-5K" precedes "SUN-10K" and
  // profiles group by manufacturer rather than index.json insertion order.
  profiles.sort(
    (a, b) =>
      a.manufacturer.localeCompare(b.manufacturer, undefined, { numeric: true }) ||
      a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
  return { profiles, errors };
}

/** One installed profile with a semver-newer release waiting in its source. */
export interface ProfileUpdate {
  id: string;
  name: string;
  manufacturer: string;
  source: string;
  installedVersion: string;
  latestVersion: string;
}

export interface UpdateCheckResult {
  /** ISO timestamp of the last completed check, or null if none has run yet. */
  checkedAt: string | null;
  updates: ProfileUpdate[];
  errors: { source: string; error: string }[];
}

/** How often the background checker syncs sources and re-diffs versions. */
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Small delay so the first check doesn't compete with boot-time git/network. */
const UPDATE_CHECK_INITIAL_DELAY_MS = 15 * 1000;

let lastUpdateCheck: UpdateCheckResult = { checkedAt: null, updates: [], errors: [] };
let checkInFlight: Promise<UpdateCheckResult> | null = null;
let updateCheckTimer: ReturnType<typeof setInterval> | null = null;

/** The most recent cached update-check result (never triggers a sync). */
export function getUpdateCheck(): UpdateCheckResult {
  return lastUpdateCheck;
}

/**
 * Sync enabled sources and diff installed versions against them, caching the
 * result for {@link getUpdateCheck}. Concurrent callers share one in-flight run
 * so a manual trigger can't stack on the background timer.
 */
function checkForUpdates(): Promise<UpdateCheckResult> {
  checkInFlight ??= runUpdateCheck().finally(() => {
    checkInFlight = null;
  });
  return checkInFlight;
}

async function runUpdateCheck(): Promise<UpdateCheckResult> {
  const { profiles, errors } = await browseAvailable();
  const updates = profiles
    .filter((p) => p.updateAvailable && p.installedVersion !== undefined)
    .map((p) => ({
      id: p.id,
      name: p.name,
      manufacturer: p.manufacturer,
      source: p.source,
      installedVersion: p.installedVersion!,
      latestVersion: p.version,
    }));
  lastUpdateCheck = { checkedAt: new Date().toISOString(), updates, errors };
  if (updates.length > 0) {
    logger.info("profile update check: {count} update(s) available", { count: updates.length });
  }
  return lastUpdateCheck;
}

/** Start the periodic update checker (initial run shortly after boot). */
export function startUpdateChecks(): void {
  if (updateCheckTimer) return;
  const run = () => {
    checkForUpdates().catch((error) => {
      logger.warn("profile update check failed: {error}", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };
  setTimeout(run, UPDATE_CHECK_INITIAL_DELAY_MS).unref();
  updateCheckTimer = setInterval(run, UPDATE_CHECK_INTERVAL_MS);
  updateCheckTimer.unref();
}

/** Stop the periodic update checker (graceful shutdown). */
export function stopUpdateChecks(): void {
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  updateCheckTimer = null;
}

/** Download, validate, and persist one profile from a source. */
export async function installProfile(
  sourceUrl: string,
  id: string,
): Promise<{ id: string; version: string }> {
  const dir = await syncRepo(sourceUrl);
  const index = await readIndex(dir);
  const entry = index.profiles.find((p) => p.id === id);
  if (!entry) throw new Error(`profile "${id}" not found in ${sourceUrl}`);

  const data = await readProfile(dir, entry.path); // strict validation happens here
  if (data.id !== id) {
    throw new Error(`profile id mismatch: index lists "${id}" but file declares "${data.id}"`);
  }

  await db
    .insert(installedProfiles)
    .values({ id: data.id, source: sourceUrl, version: data.version, data })
    .onConflictDoUpdate({
      target: installedProfiles.id,
      set: { source: sourceUrl, version: data.version, data, installedAt: new Date() },
    });

  // Register into the runtime registry so it shows in the installed list (and
  // is removable/selectable) without waiting for a restart — same call boot's
  // `loadInstalledProfiles` makes. Activation still needs a restart: the active
  // profile shapes boot-time routes/manifest/topics.
  registerProfile(hydrateProfile(data));

  logger.info('installed profile "{id}" v{version} from {source}', {
    id: data.id,
    version: data.version,
    source: sourceUrl,
  });
  return { id: data.id, version: data.version };
}

/** Remove an installed profile. */
export async function uninstallProfile(id: string): Promise<void> {
  await db.delete(installedProfiles).where(eq(installedProfiles.id, id));
  // Drop it from the runtime registry too, so an install-time registration
  // doesn't linger and re-appear (misreported as a built-in) until restart.
  unregisterProfile(id);
  logger.info('uninstalled profile "{id}"', { id });
}

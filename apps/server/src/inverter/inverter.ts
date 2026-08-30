import { db } from "@SunReye/db";
import { ACTIVE_PROFILE_KEY, activeProfileSchema } from "@SunReye/db/profiles";
import { installedProfiles } from "@SunReye/db/schema/settings";
import { env } from "@SunReye/env/server";
import { eq } from "drizzle-orm";
import {
  buildManifest,
  createInverter,
  entityConstraint,
  hydrateProfile,
  metricByKey,
  parseProfileData,
  registerProfile,
  tryGetProfile,
} from "@SunReye/inverter-core";
import type {
  InverterManifest,
  InverterProfile,
  InverterSample,
  InverterSource,
  ManifestMetric,
  MetricDef,
} from "@SunReye/inverter-core";
// No inverter profile ships in the box: the core is profile-agnostic. Profiles
// are installed from a repo source (the official one is baked in by default) and
// loaded from the database by `loadInstalledProfiles` at boot. A fresh install
// therefore boots onboarding-only until the admin installs and activates one.
import { readSetting } from "../settings/app-settings";
import { log } from "../shared/logging";
import { dropLegacyDefaultSource } from "./profiles";

const logger = log("profiles");

/**
 * Register every DB-installed profile into the runtime registry. Each row's
 * `data` is re-validated (it may predate a schema change) and skipped with a log
 * line if invalid — one bad download can never take the whole server down.
 */
async function loadInstalledProfiles(): Promise<void> {
  const rows = await db.select().from(installedProfiles);
  let loaded = 0;
  for (const row of rows) {
    try {
      registerProfile(hydrateProfile(parseProfileData(row.data)));
      loaded++;
    } catch (error) {
      logger.warn('skipping invalid installed profile "{id}": {error}', {
        id: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (loaded > 0) logger.info("loaded {count} installed profile(s)", { count: loaded });
}

/**
 * Resolve a profile by id independent of the running runtime — for a test read
 * during onboarding, when no profile is active yet. A registered profile
 * (built-in, or an install already loaded this boot) wins; otherwise the
 * DB-installed row is hydrated on the fly so a *freshly*-installed profile can be
 * test-read before the restart that would register it. `null` when unknown.
 */
export async function resolveProfileById(id: string): Promise<InverterProfile | null> {
  const registered = tryGetProfile(id);
  if (registered) return registered;
  const [row] = await db.select().from(installedProfiles).where(eq(installedProfiles.id, id));
  if (!row) return null;
  return hydrateProfile(parseProfileData(row.data));
}

/**
 * The profile id this install is CONFIGURED to use: the saved setting wins, else
 * the `INVERTER_PROFILE` env seed, else `null` when neither is set (a fresh
 * install with no config yet).
 *
 * This setting is not the answer to "what is this device", and nothing outside
 * this module should ask it as though it were — that is the `devices` table's
 * job, and `../devices/registry.ts` is what reads it. It survives as the SEED:
 * an install with no device row yet has nothing else to say which profile its
 * first device should be provisioned from.
 */
async function configuredProfileId(): Promise<string | null> {
  const stored = await readSetting(ACTIVE_PROFILE_KEY, activeProfileSchema, { id: "" });
  return stored.id || env.INVERTER_PROFILE || null;
}

/**
 * Resolve the active profile for this process. Runs the two-phase boot: built-in
 * packages have already self-registered (side-effect imports above), then DB
 * profiles are registered, then the active one is selected. Must be awaited in
 * the server's composition root before routes/manifest/topics are built.
 *
 * Returns `null` when nothing is configured (a fresh install, or a deploy that
 * cleared its active profile): the server then boots in a degraded,
 * onboarding-only mode and the admin picks a profile from the UI, which takes
 * effect on the next restart.
 */
export async function initProfiles(): Promise<InverterProfile | null> {
  await dropLegacyDefaultSource();
  await loadInstalledProfiles();
  return configuredProfile();
}

/**
 * The configured profile, resolved fresh from the setting on every call.
 *
 * A READ, not a cached global, and that is the whole point of this change. What
 * stood here was `let activeProfile: InverterProfile | null` — one profile for
 * the process, written once at boot, reachable from a forecast, an automation
 * and four routes. It could not describe a plant with two machines, it had no
 * relationship to the ids `metrics_raw` is keyed by, and every consumer that
 * only wanted a role or an id took the whole profile because it was there.
 *
 * The consumers that wanted a DEVICE now ask `../devices/registry.ts`. What is
 * left here is the two that genuinely ask about the INSTALL's configuration —
 * provisioning the first device row, and naming it — and neither of them can be
 * served by the registry, because both run before there is a device to register.
 */
export async function configuredProfile(): Promise<InverterProfile | null> {
  const id = await configuredProfileId();
  if (!id) {
    logger.warn(
      "no active inverter profile configured — booting onboarding-only (choose one in the UI, then restart)",
    );
    return null;
  }
  // The saved id may point at a profile that's no longer available — e.g. an
  // upgrade that dropped a formerly built-in package (the id lives in
  // app_settings, not the installedProfiles table, so it isn't reloaded). Don't
  // crash the whole server on a stale id: degrade to onboarding-only so the
  // admin can reinstall it from a source.
  const resolved = tryGetProfile(id);
  if (!resolved) {
    logger.warn(
      'the configured inverter profile "{id}" is not installed — booting onboarding-only (reinstall it from a profile source, then restart)',
      { id },
    );
    return null;
  }
  return resolved;
}

/**
 * What building a source needs to know about where the machine is.
 *
 * Structural, so both of its producers satisfy it without either becoming the
 * other: the poll loop's `PollEndpoint` (resolved from the `connections` +
 * `devices` spine — `./endpoint.ts`) and the connection-test route's
 * `InverterConfig` (a body the operator typed and has not saved). `host` is
 * optional because the second one's is: a test read can be attempted against a
 * half-filled form.
 */
export interface SourceConnection {
  host?: string;
  port: number;
  transport: "tcp" | "rtu-over-tcp";
  unitId: number;
  timeoutMs: number;
}

/**
 * Build a live source for a profile + endpoint. Whether it's the simulator or a
 * real Modbus source is a deploy-level choice (`INVERTER_SIMULATE`), not part of
 * the saved connection.
 */
export function buildSource(profile: InverterProfile, config: SourceConnection): InverterSource {
  return createInverter(profile, {
    simulate: env.INVERTER_SIMULATE,
    connection: {
      // Empty when the inverter hasn't been configured yet; a real connect then
      // fails (handled by the God-loop), while simulate mode ignores it entirely.
      host: config.host ?? "",
      port: config.port,
      unitId: config.unitId,
      timeoutMs: config.timeoutMs,
      transport: config.transport,
    },
  });
}

/**
 * Everything derived from the active profile, built once at boot and injected
 * into the transports (REST, MQTT) instead of a module-level singleton. Keeps
 * the profile a boot concern while the connection config stays hot-reloadable.
 */
export interface ProfileContext {
  profile: InverterProfile;
  manifest: InverterManifest;
  defByKey: Map<string, MetricDef>;
  metaByKey: Map<string, ManifestMetric>;
  /**
   * Validate a write against the entity's metadata (bounds/enum). Returns an
   * error message, or `null` when the value is acceptable. Shared by the
   * internal command endpoint, the external API, and the MQTT command bridge.
   */
  validateWrite(key: string, value: number): string | null;
}

export function buildProfileContext(profile: InverterProfile): ProfileContext {
  const manifest = buildManifest(profile);
  const defByKey = metricByKey(profile);
  const metaByKey = new Map(manifest.metrics.map((m) => [m.key, m]));

  function validateWrite(key: string, value: number): string | null {
    const def = defByKey.get(key);
    if (!def) return `Unknown entity: ${key}`;
    const c = entityConstraint(def);
    if (!c.writable) return `Entity is not writable: ${key}`;
    if (c.valueType === "enum") {
      return c.enumValues?.includes(value)
        ? null
        : `Value must be one of: ${c.enumValues?.join(", ")}`;
    }
    if (c.min !== undefined && value < c.min) return `Value ${value} is below minimum ${c.min}`;
    if (c.max !== undefined && value > c.max) return `Value ${value} is above maximum ${c.max}`;
    return null;
  }

  return { profile, manifest, defByKey, metaByKey, validateWrite };
}

// fallow-ignore-next-line unused-type -- re-exported for downstream consumers (web/tests import the sample shape from here); no in-file reference
export type { InverterSample };

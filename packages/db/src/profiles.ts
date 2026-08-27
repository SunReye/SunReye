/**
 * Profile distribution settings — the git repo sources to browse for
 * downloadable inverter profiles, and the id of the active profile. Both live
 * in `app_settings` (per-key Zod schema, like tariff/inverter/mqtt) so they are
 * editable from the UI without a redeploy.
 *
 * The active profile is intentionally *not* part of the hot-reloadable inverter
 * connection config: it shapes the REST routes, manifest, and MQTT topics built
 * once at boot, so changing it takes effect on the next restart.
 *
 * Shared by the server (boot loader + install endpoints) and the web app.
 */

import { z } from "zod";

/** `app_settings.key` under which the list of profile repo sources is stored. */
export const PROFILE_SOURCES_KEY = "profileSources";

/** `app_settings.key` under which the active profile id is stored. */
export const ACTIVE_PROFILE_KEY = "activeProfile";

/**
 * The old hardcoded default source, shipped in early builds. Superseded by
 * {@link OFFICIAL_SOURCE_URL}. Kept solely so the boot seed migration can
 * recognize and drop this stale entry from deployed DBs.
 */
export const LEGACY_DEFAULT_SOURCE_URL = "https://github.com/sunreye/inverter-profiles.git";

/**
 * The official profile repo, baked in as a default source. It's a **protected**
 * source: merge-on-read always ensures it's present, so it can be disabled (via
 * its `enabled` flag) but never removed. This is where inverter profiles live
 * now that the core ships no bundled profile.
 *
 * Consumers should go through {@link isOfficialSource} / {@link mergeOfficialSource};
 * the constant is exported only so `profiles.test.ts` can assert the recognizer
 * against the canonical URL.
 *
 * @internal
 */
export const OFFICIAL_SOURCE_URL = "https://github.com/SunReye/SunReye-Official-Profiles";

const OFFICIAL_SOURCE: ProfileSource = {
  url: OFFICIAL_SOURCE_URL,
  label: "SunReye Official Profiles",
  enabled: true,
};

/** Compare git URLs ignoring case, a trailing `.git`, and a trailing slash. */
const normalizeGitUrl = (u: string): string =>
  u
    .trim()
    .toLowerCase()
    .replace(/\.git$/, "")
    .replace(/\/$/, "");

/** Whether a URL refers to the protected official source. */
export function isOfficialSource(url: string): boolean {
  return normalizeGitUrl(url) === normalizeGitUrl(OFFICIAL_SOURCE_URL);
}

/**
 * Ensure the protected official source is present (merge-on-read/write). An
 * existing entry — including a user-disabled one — is preserved as-is; only a
 * missing one is injected (at the top). Back-fills existing installs without a
 * migration and makes the official source undeletable.
 */
export function mergeOfficialSource(sources: ProfileSource[]): ProfileSource[] {
  return sources.some((s) => isOfficialSource(s.url)) ? sources : [OFFICIAL_SOURCE, ...sources];
}

/**
 * Only public https git URLs are accepted (no ssh / private auth yet). A
 * trailing `.git` is optional — hosts like GitHub clone with or without it, and
 * the baked-in official source is written without it.
 */
const gitUrlSchema = z.url().refine((u) => u.startsWith("https://"), "must be an https git URL");

/**
 * Reached in production through {@link profileSourcesSchema}; exported only so
 * `profiles.test.ts` can assert the https/`.git` URL rules on a single entry.
 *
 * @internal
 */
export const profileSourceSchema = z.object({
  url: gitUrlSchema,
  /** Optional friendly name for the UI. */
  label: z.string().optional(),
  /** Disabled sources are kept but skipped when browsing. */
  enabled: z.boolean().default(true),
});
export type ProfileSource = z.infer<typeof profileSourceSchema>;

export const profileSourcesSchema = z.object({
  // Stored list defaults to empty; the protected official source is injected at
  // read/write time via `mergeOfficialSource` (not a stored default), so existing
  // installs are back-filled without a migration.
  sources: z.array(profileSourceSchema).default([]),
});
export type ProfileSources = z.infer<typeof profileSourcesSchema>;

export const activeProfileSchema = z.object({
  id: z.string().min(1),
});

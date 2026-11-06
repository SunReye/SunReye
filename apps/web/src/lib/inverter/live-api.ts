import type { Client } from "openapi-fetch";
import type { paths } from "$lib/core-api.gen";
import type { SourceId } from "$lib/source";
import type { RecentBackfill } from "./live-metrics";
import type { InverterManifest } from "./types";

/**
 * The active profile's manifest. `null` while onboarding is unfinished (the core answers 404 until a
 * profile is chosen), after a refused session, and when the core is unreachable: each reads as "nothing to
 * build the dashboard from yet".
 */
export async function fetchManifest(core: Client<paths>): Promise<InverterManifest | null> {
  try {
    const { data } = await core.GET("/api/profile");
    return (data as unknown as InverterManifest | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * The last `seconds` of every metric in one-second buckets, read under `source` (the core's first device
 * in service without one); `null` when the core refuses or is unreachable.
 */
export async function fetchRecent(
  core: Client<paths>,
  seconds: number,
  source?: SourceId,
): Promise<RecentBackfill | null> {
  try {
    const { data } = await core.GET("/api/history/recent", {
      params: { query: { seconds, stepSeconds: 1, source } },
    });
    return data ?? null;
  } catch {
    return null;
  }
}

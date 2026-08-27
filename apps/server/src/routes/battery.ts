import type { InverterProfile } from "@SunReye/inverter-core";
import { Elysia, t } from "elysia";
import { batteryHealthSummary, measureSegments, recordSegments } from "../battery/health";
import { batteryKeys } from "../battery/keys";
import { getWeatherConfig } from "../settings/weather-settings";
import { adminGuard } from "./admin-guard";

// 503 payload for a battery read attempted before onboarding is done.
const ONBOARDING_REQUIRED = { error: "No active inverter profile — onboarding required" } as const;

/** What a plant with no SOC or no battery-power role gets. */
const UNSUPPORTED = {
  error: "This profile maps no battery SOC or power role — capacity cannot be measured",
} as const;

export interface BatteryRoutesDeps {
  /** Active inverter profile — `null` in onboarding-only boot (routes 503). */
  profile: InverterProfile | null;
}

/**
 * Battery capacity and state of health.
 *
 * The summary is a read; the re-score is a write and is admin-only, because it
 * walks raw history and inserts. Both refuse rather than guess on a profile that
 * maps no SOC — a capacity inferred without SOC is not a capacity.
 */
export function batteryRoutes({ profile }: BatteryRoutesDeps) {
  return (
    new Elysia({ name: "battery-routes" })
      .use(adminGuard)
      .get(
        "/api/battery/health",
        { requireSession: true, query: t.Object({ inverterId: t.Optional(t.String()) }) },
        async ({ query, status }) => {
          if (!profile) return status(503, ONBOARDING_REQUIRED);
          const keys = batteryKeys(profile);
          if (!keys) return status(422, UNSUPPORTED);
          // The stated capacity, read from the plant record the inverter settings
          // own. Deliberately not a second field of its own: one battery, one
          // number — two would drift apart and make SOH quietly wrong.
          const { forecast } = await getWeatherConfig();
          return batteryHealthSummary(query.inverterId ?? profile.id, {
            nameplateKwh: forecast.battery?.usableKwh ?? null,
          });
        },
      )
      // Re-measure a window of raw history and store whatever segments it holds.
      // Idempotent (the segment's end instant is the key), so a widened window
      // adds only what is new and a repeat adds nothing — which is what makes it
      // safe to expose rather than ship as a one-shot script.
      .post(
        "/api/battery/rescore",
        {
          requireAdmin: true,
          body: t.Object({
            from: t.String(),
            to: t.String(),
            inverterId: t.Optional(t.String()),
          }),
        },
        async ({ body, status }) => {
          if (!profile) return status(503, ONBOARDING_REQUIRED);
          const keys = batteryKeys(profile);
          if (!keys) return status(422, UNSUPPORTED);
          const inverterId = body.inverterId ?? profile.id;
          const from = new Date(body.from);
          const to = new Date(body.to);
          const segments = await measureSegments(inverterId, from, to, keys);
          const stored = await recordSegments(inverterId, segments);
          return { measured: segments.length, stored };
        },
      )
  );
}

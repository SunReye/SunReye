import { inverterConfigSchema } from "@SunReye/db/inverter-config";
import { maskMqttConfig } from "@SunReye/db/mqtt-config";
import { spotPriceConfigSchema } from "@SunReye/db/spot-price-config";
import { Elysia, t } from "elysia";
import {
  getInverterConfig,
  getMqttConfig,
  mergeMqttConfig,
  setInverterConfig,
  setMqttConfig,
} from "../settings/config";
import { getAccess, setAccess } from "../settings/access-settings";
import { getChartPalette, setChartPalette } from "../settings/chart-palette-settings";
import { getDisplay, setDisplay } from "../settings/display-settings";
import { getPlant, setPlant } from "../settings/plant-settings";
import { getLoggingConfig, setLoggingConfig } from "../settings/logging-settings";
import { evccSnapshot, rebuildEvcc } from "../evcc/evcc";
import { getEvccConfig, setEvccConfig } from "../settings/evcc-settings";
import { getCorrectionView } from "../forecast/forecast-correction-job";
import { getActiveProfileOrNull } from "../inverter/inverter";
import { syncProvisioning } from "../inverter/provision-boot";
import * as runtime from "../inverter/runtime";
import { getTariff, setTariff } from "../settings/settings";
import {
  fetchSolarForecast,
  forecastProviderCatalog,
  toForecastExport,
} from "../forecast/solar-forecast";
import { getSpotPriceView, spotProviderCatalog } from "../prices/spot-price-job";
import { getSpotPriceConfig, setSpotPriceConfig } from "../settings/spot-price-settings";
import { getStatisticsPrefs, setStatisticsPrefs } from "../settings/statistics-prefs-settings";
import { getUiPrefs, setUiPrefs } from "../settings/ui-prefs-settings";
import { fetchWeather } from "../forecast/weather";
import { getWeatherConfig, setWeatherConfig } from "../settings/weather-settings";
import { adminGuard } from "./admin-guard";
import { attempt } from "./write-attempt";

/** Shared route options for an admin write of an unvalidated (schema-checked) body. */
const adminWrite = { requireAdmin: true, body: t.Unknown() } as const;

// Runtime configuration (tariff, inverter, MQTT), editable from the UI. Saving
// persists and hot-applies via the runtime controller; no restart needed. Every
// write funnels through `attempt` so a rejected body becomes a 400 with its
// reason instead of a 500 — see ./write-attempt.
export const settingsRoutes = new Elysia({ name: "settings-routes" })
  .use(adminGuard)
  // Tariff config for the web app: read the active economic model, or replace
  // it. The body is validated by the shared Zod schema (setTariff), so a bad
  // payload becomes a 400 rather than a 500.
  .get("/api/settings/tariff", { requireAdmin: true }, () => getTariff())
  .put("/api/settings/tariff", adminWrite, async ({ body, status }) => {
    const saved = await attempt(() => setTariff(body), "Invalid tariff");
    return saved.ok ? saved.value : status(400, { error: saved.error });
  })
  // Display preferences (clock format + time zone) for the web app. A shared,
  // instance-wide render setting the dashboard needs to format timestamps, so it
  // rides the dashboard read policy (session, or anonymous when the public
  // dashboard is on); only admins write.
  .get("/api/settings/display", { requireSession: true }, () => getDisplay())
  .put("/api/settings/display", adminWrite, async ({ body, status }) => {
    const saved = await attempt(() => setDisplay(body), "Invalid display");
    return saved.ok ? saved.value : status(400, { error: saved.error });
  })
  // Chart palette. A render preference exactly like display: the anonymous
  // public dashboard has to read it, or a kiosk silently draws in a different
  // palette from the one the admin chose. Only admins write.
  .get("/api/settings/chart-palette", { requireSession: true }, () => getChartPalette())
  .put("/api/settings/chart-palette", adminWrite, async ({ body, status }) => {
    const saved = await attempt(() => setChartPalette(body), "Invalid chart palette");
    return saved.ok ? saved.value : status(400, { error: saved.error });
  })
  // Plant (site) time zone — the physical zone the SERVER buckets
  // energy/cost/statistics days in, independent of the viewer's display zone.
  // Admin-only both ways: it changes how stored history is aggregated, not how
  // one browser renders it, so it is not part of the dashboard read policy.
  .get("/api/settings/plant", { requireAdmin: true }, () => getPlant())
  .put("/api/settings/plant", adminWrite, async ({ body, status }) => {
    const saved = await attempt(() => setPlant(body), "Invalid plant config");
    return saved.ok ? saved.value : status(400, { error: saved.error });
  })
  // Dashboard visibility preferences (which metrics/groups are hidden). Rides
  // the dashboard read policy so the kiosk/public view filters the same way;
  // only admins write. Hidden metrics stay polled, stored, and published to
  // MQTT / the public API — this only affects what the web app renders.
  .get("/api/settings/ui", { requireSession: true }, () => getUiPrefs())
  .put("/api/settings/ui", adminWrite, async ({ body, status }) => {
    const saved = await attempt(() => setUiPrefs(body), "Invalid preferences");
    return saved.ok ? saved.value : status(400, { error: saved.error });
  })
  // Statistics page preferences (hidden sections/tiles + per-section display
  // options). Rides the dashboard read policy so every viewer gets the curated
  // layout; only admins write. Hiding is a preference, not a capability gate —
  // the underlying endpoints stay available regardless.
  .get("/api/settings/statistics", { requireSession: true }, () => getStatisticsPrefs())
  .put(
    "/api/settings/statistics",
    { requireAdmin: true, body: t.Unknown() },
    async ({ body, status }) => {
      try {
        return await setStatisticsPrefs(body);
      } catch (error) {
        return status(400, {
          error: error instanceof Error ? error.message : "Invalid preferences",
        });
      }
    },
  )
  .get("/api/settings/inverter", { requireAdmin: true }, () => getInverterConfig())
  .put("/api/settings/inverter", adminWrite, async ({ body, status }) => {
    const saved = await attempt(async () => {
      const config = await setInverterConfig(body);
      // The endpoint the operator just described IS the `connections` row (and
      // the device's `unit_id`), so keep the spine in step with the config the
      // poll loop is about to use. Idempotent and never throws: it EDITS the
      // existing endpoint rather than adding a second one, which is why moving a
      // gateway cannot leave the device pointing at the old address.
      await syncProvisioning(getActiveProfileOrNull());
      await runtime.applyInverterConfig(config);
      return config;
    }, "Invalid config");
    return saved.ok ? saved.value : status(400, { error: saved.error });
  })
  // Test a connection against a *chosen* profile (onboarding passes the profile
  // being set up; the settings page omits it and falls back to the active one).
  // `profileId` rides alongside the connection config — the config schema strips
  // it, so it's read from the raw body first.
  .post("/api/settings/inverter/test", adminWrite, async ({ body, status }) => {
    const tested = await attempt(() => {
      const profileId = (body as { profileId?: unknown }).profileId;
      return runtime.testInverter(
        typeof profileId === "string" ? profileId : null,
        inverterConfigSchema.parse(body),
      );
    }, "Invalid config");
    return tested.ok ? tested.value : status(400, { error: tested.error });
  })
  // MQTT config: the password is masked on read and preserved on write when the
  // client omits it (write-only secret).
  .get(
    "/api/settings/mqtt",
    {
      requireAdmin: true,
    },
    async () => maskMqttConfig(await getMqttConfig()),
  )
  .put("/api/settings/mqtt", adminWrite, async ({ body, status }) => {
    const saved = await attempt(async () => {
      const config = await setMqttConfig(body);
      await runtime.applyMqttConfig(config);
      // The EVCC ingest dials the same broker on its own client, so a broker
      // change must rebuild it too.
      await rebuildEvcc();
      return maskMqttConfig(config);
    }, "Invalid config");
    return saved.ok ? saved.value : status(400, { error: saved.error });
  })
  .post("/api/settings/mqtt/test", adminWrite, async ({ body, status }) => {
    const tested = await attempt(
      async () => runtime.testMqtt(await mergeMqttConfig(body)),
      "Invalid config",
    );
    return tested.ok ? tested.value : status(400, { error: tested.error });
  })
  // Live connection health (inverter + MQTT) for the settings dashboard.
  .get("/api/status", { requireAdmin: true }, () => runtime.status())
  // Access config: the public read-only dashboard toggle. Admin-only both ways —
  // reads expose the security posture, writes change who can view the dashboard.
  .get("/api/settings/access", { requireAdmin: true }, () => getAccess())
  .put("/api/settings/access", adminWrite, async ({ body, status }) => {
    const saved = await attempt(() => setAccess(body), "Invalid access");
    return saved.ok ? saved.value : status(400, { error: saved.error });
  })
  // Runtime log level for the log viewer — persisted and hot-applied, no
  // restart. `level: null` follows the boot default; the response carries the
  // `effective` and `default` levels so the UI can label the fallback.
  .get("/api/settings/logging", { requireAdmin: true }, () => getLoggingConfig())
  .put("/api/settings/logging", adminWrite, async ({ body, status }) => {
    const saved = await attempt(() => setLoggingConfig(body), "Invalid level");
    return saved.ok ? saved.value : status(400, { error: saved.error });
  })
  // Weather config (location for the dashboard tile) — admin read + write.
  .get("/api/settings/weather", { requireAdmin: true }, () => getWeatherConfig())
  .put("/api/settings/weather", adminWrite, async ({ body, status }) => {
    const saved = await attempt(() => setWeatherConfig(body), "Invalid weather");
    return saved.ok ? saved.value : status(400, { error: saved.error });
  })
  // EVCC integration config (enable + topic root; broker comes from the MQTT
  // config above) — admin read + write. Saving hot-rebuilds the subscriber.
  .get("/api/settings/evcc", { requireAdmin: true }, () => getEvccConfig())
  .put("/api/settings/evcc", adminWrite, async ({ body, status }) => {
    const saved = await attempt(async () => {
      const config = await setEvccConfig(body);
      await rebuildEvcc();
      return config;
    }, "Invalid config");
    return saved.ok ? saved.value : status(400, { error: saved.error });
  })
  // Live EVCC loadpoint state (assembled from its retained MQTT topics). Rides
  // the dashboard read policy like weather; `null` while the ingest is disabled.
  .get("/api/evcc", { requireSession: true }, () => evccSnapshot())
  // Day-ahead price source (provider + bidding zone) — admin read + write.
  // Saving syncs immediately so the UI shows prices without waiting for the
  // half-hourly tick. The zone is checked against the provider's advertised
  // zones here rather than in the schema: the registry lives in the server, and
  // a zone the source doesn't serve would otherwise fail silently every tick.
  .get("/api/settings/spot-prices", { requireAdmin: true }, () => getSpotPriceConfig())
  .put("/api/settings/spot-prices", adminWrite, async ({ body, status }) => {
    const saved = await attempt(async () => {
      const config = spotPriceConfigSchema.parse(body);
      const provider = spotProviderCatalog().find((p) => p.id === config.provider);
      if (!provider) throw new Error(`Unknown price provider "${config.provider}"`);
      if (!provider.zones.includes(config.zone)) {
        throw new Error(`${provider.id} does not serve zone "${config.zone}"`);
      }
      const stored = await setSpotPriceConfig(config);
      await runtime.syncSpotPricesNow();
      return stored;
    }, "Invalid price source");
    return saved.ok ? saved.value : status(400, { error: saved.error });
  })
  // Registered price sources and the bidding zones each serves — feeds the
  // settings form's provider/zone pickers so they can't drift from the registry.
  .get("/api/prices/providers", { requireAdmin: true }, () => spotProviderCatalog())
  // Day-ahead prices for today + tomorrow. Public market data the dashboard
  // renders, so it rides the dashboard read policy like weather rather than
  // being admin-only. `null` when disabled/unconfigured or nothing is stored.
  //
  // Read `negativeSlots` together with `coverage`: a 0 for a day whose coverage
  // is "missing" means *unknown*, never "no negative slots".
  .get(
    "/api/prices",
    {
      requireSession: true,
    },
    async () => getSpotPriceView(await getSpotPriceConfig()),
  )
  // Current weather for the configured location (Open-Meteo, server-proxied +
  // cached), plus the PV production forecast when configured. Rides the
  // dashboard read policy so the kiosk view shows it too; `null` when weather
  // is disabled/unconfigured or the upstream is unavailable.
  .get("/api/weather", { requireSession: true }, async () => {
    const config = await getWeatherConfig();
    const [reading, forecast] = await Promise.all([
      fetchWeather(config),
      fetchSolarForecast(config),
    ]);
    return reading ? { ...reading, forecast } : null;
  })
  // The PV production forecast on its own, in the canonical export shape also
  // published to MQTT (native fields + a Solcast-style `detailedForecast` for HA
  // blueprints). `/api/forecast` is the **raw** uncurtailed PV potential (what a
  // blueprint needs to see production above the feed-in limit); `/api/forecast/usable`
  // is the post-clipping output the dashboard tile shows. Both `null` when the
  // forecast is disabled/unconfigured or the upstream fetch fails with no cache.
  .get("/api/forecast", { requireSession: true }, async () => {
    const forecast = await fetchSolarForecast(await getWeatherConfig());
    return forecast ? toForecastExport(forecast, "raw") : null;
  })
  .get("/api/forecast/usable", { requireSession: true }, async () => {
    const forecast = await fetchSolarForecast(await getWeatherConfig());
    return forecast ? toForecastExport(forecast, "usable") : null;
  })
  // Registered irradiance sources with their labels and capability flags — feeds
  // the weather form's provider picker so it can't drift from the registry.
  .get("/api/forecast/providers", { requireAdmin: true }, () => forecastProviderCatalog())
  // The learned bias-correction: state (enabled + last-learned day), the grid of
  // applied `(month, hour)` factors, and the measured error improvement — for the
  // weather-settings panel. The apply toggle itself saves via the weather config.
  .get(
    "/api/forecast/correction",
    {
      requireSession: true,
    },
    () => getWeatherConfig().then(getCorrectionView),
  );

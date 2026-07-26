import { inverterConfigSchema } from "@SunReye/db/inverter-config";
import { maskMqttConfig } from "@SunReye/db/mqtt-config";
import { Elysia, t } from "elysia";
import {
  getInverterConfig,
  getMqttConfig,
  mergeMqttConfig,
  setInverterConfig,
  setMqttConfig,
} from "../config";
import { getAccess, setAccess } from "../access-settings";
import { getDisplay, setDisplay } from "../display-settings";
import { getLoggingConfig, setLoggingConfig } from "../logging-settings";
import { evccSnapshot, rebuildEvcc } from "../evcc";
import { getEvccConfig, setEvccConfig } from "../evcc-settings";
import { getCorrectionView } from "../forecast-correction-job";
import * as runtime from "../runtime";
import { getTariff, setTariff } from "../settings";
import { fetchSolarForecast, toForecastExport } from "../solar-forecast";
import { getUiPrefs, setUiPrefs } from "../ui-prefs-settings";
import { fetchWeather } from "../weather";
import { getWeatherConfig, setWeatherConfig } from "../weather-settings";
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
  .get("/api/settings/tariff", () => getTariff(), { requireAdmin: true })
  .put(
    "/api/settings/tariff",
    async ({ body, status }) => {
      const saved = await attempt(() => setTariff(body), "Invalid tariff");
      return saved.ok ? saved.value : status(400, { error: saved.error });
    },
    adminWrite,
  )
  // Display preferences (clock format + time zone) for the web app. A shared,
  // instance-wide render setting the dashboard needs to format timestamps, so it
  // rides the dashboard read policy (session, or anonymous when the public
  // dashboard is on); only admins write.
  .get("/api/settings/display", () => getDisplay(), { requireSession: true })
  .put(
    "/api/settings/display",
    async ({ body, status }) => {
      const saved = await attempt(() => setDisplay(body), "Invalid display");
      return saved.ok ? saved.value : status(400, { error: saved.error });
    },
    adminWrite,
  )
  // Dashboard visibility preferences (which metrics/groups are hidden). Rides
  // the dashboard read policy so the kiosk/public view filters the same way;
  // only admins write. Hidden metrics stay polled, stored, and published to
  // MQTT / the public API — this only affects what the web app renders.
  .get("/api/settings/ui", () => getUiPrefs(), { requireSession: true })
  .put(
    "/api/settings/ui",
    async ({ body, status }) => {
      const saved = await attempt(() => setUiPrefs(body), "Invalid preferences");
      return saved.ok ? saved.value : status(400, { error: saved.error });
    },
    adminWrite,
  )
  .get("/api/settings/inverter", () => getInverterConfig(), { requireAdmin: true })
  .put(
    "/api/settings/inverter",
    async ({ body, status }) => {
      const saved = await attempt(async () => {
        const config = await setInverterConfig(body);
        await runtime.applyInverterConfig(config);
        return config;
      }, "Invalid config");
      return saved.ok ? saved.value : status(400, { error: saved.error });
    },
    adminWrite,
  )
  // Test a connection against a *chosen* profile (onboarding passes the profile
  // being set up; the settings page omits it and falls back to the active one).
  // `profileId` rides alongside the connection config — the config schema strips
  // it, so it's read from the raw body first.
  .post(
    "/api/settings/inverter/test",
    async ({ body, status }) => {
      const tested = await attempt(() => {
        const profileId = (body as { profileId?: unknown }).profileId;
        return runtime.testInverter(
          typeof profileId === "string" ? profileId : null,
          inverterConfigSchema.parse(body),
        );
      }, "Invalid config");
      return tested.ok ? tested.value : status(400, { error: tested.error });
    },
    adminWrite,
  )
  // MQTT config: the password is masked on read and preserved on write when the
  // client omits it (write-only secret).
  .get("/api/settings/mqtt", async () => maskMqttConfig(await getMqttConfig()), {
    requireAdmin: true,
  })
  .put(
    "/api/settings/mqtt",
    async ({ body, status }) => {
      const saved = await attempt(async () => {
        const config = await setMqttConfig(body);
        await runtime.applyMqttConfig(config);
        // The EVCC ingest dials the same broker on its own client, so a broker
        // change must rebuild it too.
        await rebuildEvcc();
        return maskMqttConfig(config);
      }, "Invalid config");
      return saved.ok ? saved.value : status(400, { error: saved.error });
    },
    adminWrite,
  )
  .post(
    "/api/settings/mqtt/test",
    async ({ body, status }) => {
      const tested = await attempt(
        async () => runtime.testMqtt(await mergeMqttConfig(body)),
        "Invalid config",
      );
      return tested.ok ? tested.value : status(400, { error: tested.error });
    },
    adminWrite,
  )
  // Live connection health (inverter + MQTT) for the settings dashboard.
  .get("/api/status", () => runtime.status(), { requireAdmin: true })
  // Access config: the public read-only dashboard toggle. Admin-only both ways —
  // reads expose the security posture, writes change who can view the dashboard.
  .get("/api/settings/access", () => getAccess(), { requireAdmin: true })
  .put(
    "/api/settings/access",
    async ({ body, status }) => {
      const saved = await attempt(() => setAccess(body), "Invalid access");
      return saved.ok ? saved.value : status(400, { error: saved.error });
    },
    adminWrite,
  )
  // Runtime log level for the log viewer — persisted and hot-applied, no
  // restart. `level: null` follows the boot default; the response carries the
  // `effective` and `default` levels so the UI can label the fallback.
  .get("/api/settings/logging", () => getLoggingConfig(), { requireAdmin: true })
  .put(
    "/api/settings/logging",
    async ({ body, status }) => {
      const saved = await attempt(() => setLoggingConfig(body), "Invalid level");
      return saved.ok ? saved.value : status(400, { error: saved.error });
    },
    adminWrite,
  )
  // Weather config (location for the dashboard tile) — admin read + write.
  .get("/api/settings/weather", () => getWeatherConfig(), { requireAdmin: true })
  .put(
    "/api/settings/weather",
    async ({ body, status }) => {
      const saved = await attempt(() => setWeatherConfig(body), "Invalid weather");
      return saved.ok ? saved.value : status(400, { error: saved.error });
    },
    adminWrite,
  )
  // EVCC integration config (enable + topic root; broker comes from the MQTT
  // config above) — admin read + write. Saving hot-rebuilds the subscriber.
  .get("/api/settings/evcc", () => getEvccConfig(), { requireAdmin: true })
  .put(
    "/api/settings/evcc",
    async ({ body, status }) => {
      const saved = await attempt(async () => {
        const config = await setEvccConfig(body);
        await rebuildEvcc();
        return config;
      }, "Invalid config");
      return saved.ok ? saved.value : status(400, { error: saved.error });
    },
    adminWrite,
  )
  // Live EVCC loadpoint state (assembled from its retained MQTT topics). Rides
  // the dashboard read policy like weather; `null` while the ingest is disabled.
  .get("/api/evcc", () => evccSnapshot(), { requireSession: true })
  // Current weather for the configured location (Open-Meteo, server-proxied +
  // cached), plus the PV production forecast when configured. Rides the
  // dashboard read policy so the kiosk view shows it too; `null` when weather
  // is disabled/unconfigured or the upstream is unavailable.
  .get(
    "/api/weather",
    async () => {
      const config = await getWeatherConfig();
      const [reading, forecast] = await Promise.all([
        fetchWeather(config),
        fetchSolarForecast(config),
      ]);
      return reading ? { ...reading, forecast } : null;
    },
    { requireSession: true },
  )
  // The PV production forecast on its own, in the canonical export shape also
  // published to MQTT (native fields + a Solcast-style `detailedForecast` for HA
  // blueprints). `/api/forecast` is the **raw** uncurtailed PV potential (what a
  // blueprint needs to see production above the feed-in limit); `/api/forecast/usable`
  // is the post-clipping output the dashboard tile shows. Both `null` when the
  // forecast is disabled/unconfigured or the upstream fetch fails with no cache.
  .get(
    "/api/forecast",
    async () => {
      const forecast = await fetchSolarForecast(await getWeatherConfig());
      return forecast ? toForecastExport(forecast, "raw") : null;
    },
    { requireSession: true },
  )
  .get(
    "/api/forecast/usable",
    async () => {
      const forecast = await fetchSolarForecast(await getWeatherConfig());
      return forecast ? toForecastExport(forecast, "usable") : null;
    },
    { requireSession: true },
  )
  // The learned bias-correction: state (enabled + last-learned day), the grid of
  // applied `(month, hour)` factors, and the measured error improvement — for the
  // weather-settings panel. The apply toggle itself saves via the weather config.
  .get("/api/forecast/correction", () => getWeatherConfig().then(getCorrectionView), {
    requireSession: true,
  });

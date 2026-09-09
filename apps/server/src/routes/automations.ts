import { automationConfigSchema } from "@SunReye/db/automation-config";
import { Elysia, t } from "elysia";
import { automationPlan, automationStatus, applyAutomationConfig } from "../automation/automation";
import { getAutomationConfig, setAutomationConfig } from "../settings/automation-settings";
import { deviceRegistry } from "../devices/registry-instance";
import { validateAutomationEnable } from "../automation/peak-shaving";
import { getWeatherConfig } from "../settings/weather-settings";
import { adminGuard } from "./admin-guard";
import { attempt } from "./write-attempt";

// Automations config + live engine status. Admin-only both ways: the config
// enables register writes, and the status exposes what the engine is doing to
// them. Saving hot-applies via one immediate engine tick; no restart needed.
export const automationRoutes = new Elysia({ name: "automation-routes" })
  .use(adminGuard)
  .get("/api/settings/automations", { requireAdmin: true }, () => getAutomationConfig())
  .put(
    "/api/settings/automations",
    { requireAdmin: true, body: t.Unknown() },
    async ({ body, status }) => {
      const checked = await attempt(async () => {
        // Validate the shape first so the enable-guard reasons about the exact
        // config that would be persisted (defaults applied, unknowns stripped).
        const parsed = automationConfigSchema.parse(body);
        // The same registered device the engine steers, so "can enable" and
        // "keeps running" are answered off one description of the machine.
        const device = deviceRegistry.primary();
        return {
          parsed,
          rejected: validateAutomationEnable(parsed, device, await getWeatherConfig()),
        };
      }, "Invalid config");
      if (!checked.ok) return status(400, { error: checked.error });
      if (checked.value.rejected) return status(400, checked.value.rejected);

      const saved = await attempt(async () => {
        const config = await setAutomationConfig(checked.value.parsed);
        await applyAutomationConfig();
        return config;
      }, "Invalid config");
      return saved.ok ? saved.value : status(400, { error: saved.error });
    },
  )
  // Live engine state for the automations tab (poll-friendly, in-memory only).
  .get("/api/automations/status", { requireAdmin: true }, () => automationStatus())
  // There is deliberately NO `/api/automations/history` any more (#172). The
  // optimizer is a device, its decisions are rows in `metrics_raw` keyed to the
  // slug `optimizer`, and `GET /api/history` and `GET /api/history/rollup`
  // answer for it exactly as they do for an inverter — with rollups, CSV export,
  // custom charts, an archive round trip, and a history that survives a restart.
  // The endpoint it replaced could offer none of those: it read a 2 880-slot
  // in-memory ring.
  //
  // Forward projection of the rest of today (charge windows + SOC trajectory).
  // This one STAYS: it is a forecast, not a measurement, and writing the future
  // into a hypertable would be a lie about what was observed.
  .get("/api/automations/plan", { requireAdmin: true }, () => automationPlan());

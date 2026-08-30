import { automationConfigSchema } from "@SunReye/db/automation-config";
import { Elysia, t } from "elysia";
import {
  automationHistory,
  automationPlan,
  automationStatus,
  applyAutomationConfig,
} from "../automation/automation";
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
        // The engine still reasons in profiles (#171 moves it onto the
        // registry's instances); what changed is WHERE the profile comes from —
        // the plant's primary inverter, not a module global.
        const profile = deviceRegistry.primaryProfile();
        return {
          parsed,
          rejected: validateAutomationEnable(parsed, profile, await getWeatherConfig()),
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
  // Rolling decision history behind the automation charts; also in-memory only,
  // so it starts empty after a restart and needs no retention policy.
  .get("/api/automations/history", { requireAdmin: true }, () => automationHistory())
  // Forward projection of the rest of today (charge windows + SOC trajectory).
  .get("/api/automations/plan", { requireAdmin: true }, () => automationPlan());

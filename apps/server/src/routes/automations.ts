import { automationConfigSchema } from "@SunReye/db/automation-config";
import { Elysia, t } from "elysia";
import { automationStatus, applyAutomationConfig } from "../automation";
import { getAutomationConfig, setAutomationConfig } from "../automation-settings";
import { getActiveProfileOrNull } from "../inverter";
import { validateAutomationEnable } from "../peak-shaving";
import { getWeatherConfig } from "../weather-settings";
import { adminGuard } from "./admin-guard";

// Automations config + live engine status. Admin-only both ways: the config
// enables register writes, and the status exposes what the engine is doing to
// them. Saving hot-applies via one immediate engine tick; no restart needed.
export const automationRoutes = new Elysia({ name: "automation-routes" })
  .use(adminGuard)
  .get("/api/settings/automations", () => getAutomationConfig(), { requireAdmin: true })
  .put(
    "/api/settings/automations",
    async ({ body, status }) => {
      try {
        // Validate the shape first so the enable-guard reasons about the exact
        // config that would be persisted (defaults applied, unknowns stripped).
        const parsed = automationConfigSchema.parse(body);
        const rejected = validateAutomationEnable(
          parsed,
          getActiveProfileOrNull(),
          await getWeatherConfig(),
        );
        if (rejected) return status(400, rejected);
        const config = await setAutomationConfig(parsed);
        await applyAutomationConfig();
        return config;
      } catch (error) {
        return status(400, { error: error instanceof Error ? error.message : "Invalid config" });
      }
    },
    { requireAdmin: true, body: t.Unknown() },
  )
  // Live engine state for the automations tab (poll-friendly, in-memory only).
  .get("/api/automations/status", () => automationStatus(), { requireAdmin: true });

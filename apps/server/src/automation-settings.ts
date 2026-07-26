/**
 * Automations config (master gate + per-automation knobs), cached in memory
 * and invalidated on write. Persisted via the shared `app_settings` accessor.
 * Plant parameters are deliberately absent — they come from the weather config.
 */

import {
  AUTOMATION_KEY,
  automationConfigSchema,
  defaultAutomations,
} from "@SunReye/db/automation-config";
import { cachedSetting } from "./app-settings";

const automations = cachedSetting(AUTOMATION_KEY, automationConfigSchema, defaultAutomations);

export const getAutomationConfig = automations.get;
export const setAutomationConfig = automations.set;

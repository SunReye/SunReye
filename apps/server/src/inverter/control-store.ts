/**
 * Production {@link ControlStore}: composite-control runtime state persisted in
 * `app_settings` and cached in memory (invalidated on write) so the poll loop
 * can read lock state without a db hit. Kept apart from the interpreter
 * (control-expr.ts) so that module stays free of db/env imports and unit-testable.
 */

import {
  CONTROL_STATE_KEY,
  type ControlState,
  controlStateSchema,
  defaultControlState,
} from "@SunReye/db/control-state";
import { readSetting, writeSetting } from "../settings/app-settings";
import type { ControlStore } from "./control-expr";

export const dbControlStore: ControlStore = (() => {
  let cache: ControlState | null = null;
  return {
    async get() {
      cache ??= await readSetting(CONTROL_STATE_KEY, controlStateSchema, defaultControlState);
      return cache;
    },
    async set(next) {
      await writeSetting(CONTROL_STATE_KEY, next);
      cache = next;
    },
  };
})();

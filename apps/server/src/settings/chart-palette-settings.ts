/**
 * Which colour palette the web app renders charts in, cached in memory and
 * invalidated on write. Persisted via the shared `app_settings` accessor.
 */

import {
  CHART_PALETTE_KEY,
  chartPaletteSchema,
  defaultChartPalette,
} from "@SunReye/db/chart-palette";
import { cachedSetting } from "./app-settings";

const palette = cachedSetting(CHART_PALETTE_KEY, chartPaletteSchema, defaultChartPalette);

/** The instance's palette, or the shipped one when nothing is stored. */
export const getChartPalette = palette.get;

/** Validate and persist the palette (upsert), refreshing the cache. */
export const setChartPalette = palette.set;

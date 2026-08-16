/**
 * Turning a stored palette id into what the document actually wears.
 *
 * Two things are decided here rather than in the component: which id to trust,
 * and whether the attribute is set at all. The shipped palette stamps NOTHING —
 * it is what `:root` already declares, so stamping it would mean an instance
 * that never chose still depends on a preset block existing.
 */

/** Kept in step with `PALETTE_PRESETS` in `@SunReye/db/chart-palette`. */
export const PALETTE_PRESETS = ["categorical", "colorblind", "vivid", "muted"] as const;
export type PalettePreset = (typeof PALETTE_PRESETS)[number];

/** The palette an instance renders in before anyone chooses. */
export const DEFAULT_PRESET: PalettePreset = "categorical";

export function isPalettePreset(value: unknown): value is PalettePreset {
  return typeof value === "string" && (PALETTE_PRESETS as readonly string[]).includes(value);
}

/**
 * The preset to render, given the instance setting and this browser's own
 * override.
 *
 * The override wins. It exists so a reader who cannot separate the instance
 * palette can help themselves without being an admin and without changing what
 * the wall display shows — the setting is one plant, the override is one pair
 * of eyes. Anything unrecognised on either side degrades rather than throws:
 * both arrive from storage, one of them from `localStorage`, which anything on
 * the device can write.
 */
export function resolvePreset(instance: unknown, override: unknown): PalettePreset {
  if (isPalettePreset(override)) return override;
  return isPalettePreset(instance) ? instance : DEFAULT_PRESET;
}

/**
 * The value for the document's `data-palette` attribute, or `null` to remove
 * it. `null` for the shipped palette: it is `:root` itself.
 */
export function paletteAttribute(preset: PalettePreset): string | null {
  return preset === DEFAULT_PRESET ? null : preset;
}

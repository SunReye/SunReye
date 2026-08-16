import { api } from "$lib/api";
import { payloadOrNull } from "$lib/api-payload";
import {
  DEFAULT_PRESET,
  isPalettePreset,
  paletteAttribute,
  resolvePreset,
  type PalettePreset,
} from "$lib/inverter/palette-preset";

/** Where this browser's personal override lives. */
const OVERRIDE_KEY = "sunreye.palette";

/**
 * The last instance setting this browser saw. Not a preference — a cache, so a
 * returning viewer paints in the right palette instead of rendering the shipped
 * one and re-hueing when the fetch lands. The fetch still runs and still wins;
 * this only removes the flash.
 */
const INSTANCE_CACHE_KEY = "sunreye.palette.instance";

/**
 * Which palette the charts and the power-flow diagram are drawn in.
 *
 * Two values, deliberately. The INSTANCE setting is what the plant renders in —
 * admin-set, shared, and what a wall display shows. The OVERRIDE is this
 * browser's own, kept in `localStorage` and never sent anywhere: a reader who
 * cannot separate the instance palette can help themselves without being an
 * admin and without changing what anyone else sees.
 *
 * The resolved preset is stamped on `<html>` as `data-palette`, which is all
 * the CSS needs — the tokens are re-pointed by the preset blocks in app.css.
 * The shipped palette stamps nothing, because it is `:root` itself.
 */
class ChartPaletteStore {
  /** The instance-wide setting, as saved by an admin. */
  instance = $state<PalettePreset>(DEFAULT_PRESET);
  /** This browser's override, or null to follow the instance. */
  override = $state<PalettePreset | null>(null);
  #loadPromise: Promise<void> | null = null;

  /** What is actually rendered. */
  active = $derived(resolvePreset(this.instance, this.override));

  /**
   * Read this browser's override. Called before the first paint, so it must
   * cope with `localStorage` being unavailable (private mode, or an embedded
   * webview) rather than throwing on the way up.
   */
  loadOverride(): void {
    try {
      const stored = localStorage.getItem(OVERRIDE_KEY);
      this.override = isPalettePreset(stored) ? stored : null;
      // Seed the instance from the last one seen, so the first paint is already
      // right on a plant whose admin chose something. `load()` corrects it.
      const cached = localStorage.getItem(INSTANCE_CACHE_KEY);
      if (isPalettePreset(cached)) this.instance = cached;
    } catch {
      this.override = null;
    }
  }

  /** Set or clear this browser's override. `null` means "follow the instance". */
  setOverride(next: PalettePreset | null): void {
    this.override = next;
    try {
      if (next) localStorage.setItem(OVERRIDE_KEY, next);
      else localStorage.removeItem(OVERRIDE_KEY);
    } catch {
      // A device that cannot persist it still gets it for this session.
    }
  }

  /**
   * Fetch the instance setting once. Concurrent callers (the layout and the
   * settings form) share the same in-flight request.
   */
  load(): Promise<void> {
    this.#loadPromise ??= api.api.settings["chart-palette"].get().then(({ data }) => {
      const preset = (data as { preset?: unknown } | null)?.preset;
      if (isPalettePreset(preset)) this.#rememberInstance(preset);
    });
    return this.#loadPromise;
  }

  #rememberInstance(preset: PalettePreset): void {
    this.instance = preset;
    try {
      localStorage.setItem(INSTANCE_CACHE_KEY, preset);
    } catch {
      // A device that cannot cache it just flashes once per load.
    }
  }

  /** Persist the instance setting. Admin-only server-side; false on rejection. */
  async save(preset: PalettePreset): Promise<boolean> {
    const { data, error } = await api.api.settings["chart-palette"].put({ preset });
    if (error) return false;
    const saved = payloadOrNull<{ preset: PalettePreset }>(data);
    this.#rememberInstance(saved && isPalettePreset(saved.preset) ? saved.preset : preset);
    return true;
  }

  /**
   * Put the resolved preset on the document. Call from an `$effect` — it reads
   * `active`, so it re-runs when either half changes and the whole app re-hues
   * without a reload.
   */
  stamp(): void {
    const attribute = paletteAttribute(this.active);
    if (attribute) document.documentElement.dataset.palette = attribute;
    else delete document.documentElement.dataset.palette;
  }
}

export const chartPalette = new ChartPaletteStore();

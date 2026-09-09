import { api } from "$lib/api";
import { payloadOrNull } from "$lib/api-payload";

/** `timeZone` sentinel meaning "fall back to the server host zone". */
const PLANT_ZONE_AUTO = "auto";

/**
 * Plant (site) configuration shape. Mirrors the server's `plantConfigSchema`
 * (packages/db/src/plant.ts) — kept as a local type per the web convention of
 * not depending on the db package (see display.svelte.ts / tariff-form.svelte).
 */
export type PlantConfig = {
  /** IANA zone the SERVER buckets energy/cost/statistics days in, or `"auto"`. */
  timeZone: string;
  /**
   * The plant's editable label, present on every read and OPTIONAL on a write.
   *
   * Optional because the server writes only the fields a request names: the
   * Display form sends the time zone alone, and including a stale name there is
   * exactly the read-modify-write that used to make two settings pages overwrite
   * each other. There is no editor for it yet — the migration's onboarding step
   * owns that form. Never the plant's `slug`, which is frozen at onboarding
   * because it becomes the MQTT namespace.
   */
  name?: string;
};

const defaultPlant: PlantConfig = { timeZone: PLANT_ZONE_AUTO };

/**
 * The instance-wide plant configuration on the client. Admin-only (the GET is
 * `requireAdmin`), so only the settings form loads it — never the shared layout.
 * Unlike {@link DisplayStore} it drives server-side bucketing, not browser
 * rendering, so it holds no reactive formatters.
 */
class PlantStore {
  config = $state<PlantConfig>(defaultPlant);
  #loadPromise: Promise<void> | null = null;

  /** Fetch the saved plant config once; concurrent callers share the request. */
  load(): Promise<void> {
    this.#loadPromise ??= api.api.settings.plant.get().then(({ data }) => {
      if (data) this.config = data as PlantConfig;
    });
    return this.#loadPromise;
  }

  /** Persist a new plant config; on success updates the cached value. */
  async save(next: PlantConfig): Promise<boolean> {
    const { data, error } = await api.api.settings.plant.put(next);
    if (error) return false;
    this.config = payloadOrNull<PlantConfig>(data) ?? next;
    return true;
  }
}

export const plant = new PlantStore();

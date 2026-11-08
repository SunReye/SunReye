import { api } from "$lib/api";
import { payloadOrNull } from "$lib/api-payload";

/** `timeZone` sentinel meaning "follow the viewer's system zone". */
export const TIME_ZONE_AUTO = "auto";

/**
 * Display preferences shape. Mirrors the server's `displayConfigSchema`
 * (packages/db/src/display.ts) — kept as a local type per the web convention of
 * not depending on the db package (see tariff-form.svelte).
 */
export type DisplayConfig = {
  hourCycle: "auto" | "12h" | "24h";
  /** IANA zone name, or {@link TIME_ZONE_AUTO}. */
  timeZone: string;
};

/** Locale-following defaults used before the preference loads. */
const defaultDisplay: DisplayConfig = { hourCycle: "auto", timeZone: TIME_ZONE_AUTO };

/**
 * Instance-wide display preferences (clock format + time zone) on the client.
 * Fetched once per session and cached; the reactive `Intl.DateTimeFormat`
 * formatters rebuild whenever the config changes, so every chart tooltip and
 * date label re-renders the moment the setting is saved — no reload needed.
 *
 * Formatter methods are cheap to call from templates/`$derived`: the underlying
 * `Intl` objects are memoized via `$derived` and only reconstructed on a config
 * change (not per call). Reading them inside a component makes it reactive.
 */
class DisplayStore {
  config = $state<DisplayConfig>(defaultDisplay);
  #loadPromise: Promise<void> | null = null;

  // `auto` → undefined lets `Intl` fall back to the locale/system default.
  #hour12 = $derived(
    this.config.hourCycle === "auto" ? undefined : this.config.hourCycle === "12h",
  );
  #timeZone = $derived(this.config.timeZone === TIME_ZONE_AUTO ? undefined : this.config.timeZone);

  #timeFmt = $derived(
    new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: this.#hour12,
      timeZone: this.#timeZone,
    }),
  );
  #timeSecFmt = $derived(
    new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: this.#hour12,
      timeZone: this.#timeZone,
    }),
  );
  #dayFmt = $derived(
    new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      timeZone: this.#timeZone,
    }),
  );

  /** Clock time, e.g. `14:05` or `2:05 PM`. */
  time(d: Date): string {
    return this.#timeFmt.format(d);
  }

  /** Clock time with seconds (live sparkline tooltips). */
  timeWithSeconds(d: Date): string {
    return this.#timeSecFmt.format(d);
  }

  /** Short calendar day, e.g. `Jul 13`. */
  day(d: Date): string {
    return this.#dayFmt.format(d);
  }

  /** Day + clock time, e.g. `Jul 13 14:05` (historical chart tooltips). */
  dayTime(d: Date): string {
    return `${this.#dayFmt.format(d)} ${this.#timeFmt.format(d)}`;
  }

  /**
   * Fetch the saved preference once. Concurrent callers (layout + settings
   * form) share the same in-flight request and all resolve with config set.
   */
  load(): Promise<void> {
    this.#loadPromise ??= api.api.settings.display.get().then(({ data }) => {
      if (data) this.config = data as DisplayConfig;
    });
    return this.#loadPromise;
  }

  /** Persist a new config; on success the reactive formatters update in place. */
  async save(next: DisplayConfig): Promise<boolean> {
    const { data, error } = await api.api.settings.display.put(next);
    if (error) return false;
    this.config = payloadOrNull<DisplayConfig>(data) ?? next;
    return true;
  }
}

export const display = new DisplayStore();

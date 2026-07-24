import { SvelteMap } from "svelte/reactivity";
import { api } from "$lib/api";
import { uiPrefs } from "$lib/ui-prefs.svelte";
import type {
  CanonicalRole,
  InverterCapabilities,
  InverterManifest,
  LivePoint,
  LiveSample,
  ManifestMetric,
} from "./types";

/** Trailing time window kept per metric for live sparklines. */
const WINDOW_MS = 5 * 60 * 1000;
/** Hard per-metric point cap so a faster-than-1 Hz feed can't grow unbounded. */
const MAX_POINTS = 5000;

/** Reconnect backoff: first retry, then doubling, capped. */
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 30_000;

type Status = "idle" | "connecting" | "live" | "closed";

/** The live-metrics socket handle (Eden `EdenWS`). */
type MetricsSocket = ReturnType<typeof api.ws.metrics.subscribe>;

/**
 * Single source of truth for the active inverter on the client. Holds the
 * capability manifest (fetched once) and the live sample stream, plus small
 * per-metric ring buffers so KPI cards can draw live sparklines. Everything the
 * UI renders is keyed off `manifest` — no vendor-specific code lives here.
 */
class InverterStore {
  manifest = $state<InverterManifest | null>(null);
  latest = $state<LiveSample | null>(null);
  status = $state<Status>("idle");

  /**
   * Exponentially-smoothed interval between live samples (ms). Seeds at the
   * nominal 1 Hz and adapts to the server's real poll cadence, which the user
   * can set anywhere from 1 s to 1 h. Consumers (`AnimatedNumber`, the live
   * chart cursor) stretch their per-frame glide across this so values drift
   * continuously between samples instead of snapping and freezing.
   */
  cadenceMs = $state(1000);
  /** Sample time of the previous live message; drives the cadence estimate. */
  #lastSampleT: number | null = null;

  // Reactive map: metric key → recent points. Plain `Map` in `$state` is NOT
  // reactive on get/set — SvelteMap tracks per-key mutations so sparklines
  // update the instant a new point lands.
  #series = new SvelteMap<string, LivePoint[]>();
  #ws: MetricsSocket | null = null;
  #started = false;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #reconnectAttempts = 0;
  #onVisibility: (() => void) | null = null;

  get capabilities(): InverterCapabilities | null {
    return this.manifest?.capabilities ?? null;
  }

  /**
   * The metric catalog the UI renders — everything downstream (`byRole`,
   * `inGroup`, `allByRole`, and both pages' direct reads) flows through here,
   * so filtering hidden metrics/groups at this one point covers the dashboard,
   * system page, history, controls, and power-flow. Hidden metrics keep being
   * polled/stored/published; they're only dropped from this view.
   */
  get metrics(): ManifestMetric[] {
    return this.allMetrics.filter((m) => !uiPrefs.isHidden(m.key, m.group));
  }

  /** The unfiltered catalog (for the visibility settings form). */
  get allMetrics(): ManifestMetric[] {
    return this.manifest?.metrics ?? [];
  }

  /** Latest live value for a metric key, if streamed yet. */
  value(key: string): number | undefined {
    return this.latest?.metrics[key];
  }

  /** Recent live points for a metric key (for sparklines). */
  series(key: string): LivePoint[] {
    return this.#series.get(key) ?? [];
  }

  /** First metric mapped to a canonical role (optionally at a 1-based index). */
  byRole(role: CanonicalRole, index?: number): ManifestMetric | undefined {
    return this.metrics.find((m) => m.role === role && (index === undefined || m.index === index));
  }

  /** All metrics mapped to a role, ordered by index. */
  allByRole(role: CanonicalRole): ManifestMetric[] {
    return this.metrics
      .filter((m) => m.role === role)
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  }

  /** Metrics in a profile group (inverter, battery, settings, ...). */
  inGroup(group: string): ManifestMetric[] {
    return this.metrics.filter((m) => m.group === group);
  }

  /** Fetch the manifest, backfill live buffers, and open the live stream. Idempotent. */
  start(): void {
    if (this.#started) return;
    this.#started = true;
    if (typeof document !== "undefined") {
      this.#onVisibility = () => this.#handleVisibility();
      document.addEventListener("visibilitychange", this.#onVisibility);
    }
    void this.#init();
  }

  /**
   * On tab hide, close the socket so the browser doesn't buffer a backlog of 1 Hz
   * samples to flush (and animate through) on return. On show, reconnect and
   * backfill so the buffers jump straight to the newest data instead of replaying
   * the gap. A tab that was only briefly hidden simply reconnects immediately.
   */
  #handleVisibility(): void {
    if (typeof document === "undefined") return;
    if (document.visibilityState === "hidden") {
      this.#teardownSocket();
      this.status = "idle";
    } else if (this.#started && this.#ws === null) {
      this.#clearReconnectTimer();
      this.#reconnectAttempts = 0;
      void this.#reconnect();
    }
  }

  async #init(): Promise<void> {
    // Load visibility prefs so the metric getter filters from the first render;
    // fire-and-forget — a default (nothing hidden) is the safe fallback and the
    // reactive getter re-filters once it resolves.
    void uiPrefs.load();
    await this.#loadManifest();
    // Seed sparklines with the last window of raw samples so they're populated
    // on load, then attach the live stream which appends from here on.
    await this.#backfill();
    this.#connect();
  }

  async #loadManifest(): Promise<void> {
    const { data } = await api.api.profile.get();
    if (data) this.manifest = data as unknown as InverterManifest;
  }

  async #backfill(): Promise<void> {
    // Over-fetch: pull the whole 5-minute buffer across every metric at the
    // endpoint's max row cap. `desc + limit` returns the most-recent rows, so a
    // small cap would only reach back a few seconds under a dense/multi-metric
    // feed and leave the sparkline window unfilled. Downsample-to-1Hz keeps the
    // client cheap regardless of how many rows come back.
    const { data } = await api.api.history.recent.get({
      query: { seconds: WINDOW_MS / 1000, limit: 200000 },
    });
    if (!data) return;
    const byMetric = new Map<string, LivePoint[]>();
    for (const row of data) {
      const points = byMetric.get(row.metric) ?? [];
      points.push({ t: new Date(row.time).getTime(), v: row.value });
      byMetric.set(row.metric, points);
    }
    for (const [key, points] of byMetric) {
      // Rows arrive newest-first; sort ascending and keep the trailing window.
      points.sort((a, b) => a.t - b.t);
      this.#series.set(key, this.#trim(this.#downsampleToHz(points)));
    }
  }

  /**
   * Collapse the backfill to ~1 point/second so it matches the live stream's
   * density. The raw table can hold denser-than-1 Hz rows, which would make a
   * reloaded sparkline look far more compressed than one built live. Points are
   * ascending; keep the last sample in each 1-second bucket.
   */
  #downsampleToHz(points: LivePoint[]): LivePoint[] {
    const out: LivePoint[] = [];
    let bucket = Number.NaN;
    for (const p of points) {
      const b = Math.floor(p.t / 1000);
      if (b === bucket) out[out.length - 1] = p;
      else {
        out.push(p);
        bucket = b;
      }
    }
    return out;
  }

  /** Keep points within the trailing window, bounded by the hard cap. */
  #trim(points: LivePoint[]): LivePoint[] {
    const cutoff = (points.at(-1)?.t ?? 0) - WINDOW_MS;
    const windowed = points.filter((p) => p.t >= cutoff);
    return windowed.length > MAX_POINTS ? windowed.slice(-MAX_POINTS) : windowed;
  }

  #connect(): void {
    // Drop any prior socket first; its handlers are identity-guarded on `#ws`, so
    // once it's no longer the current socket they become no-ops (no stray
    // reconnect from a superseded connection).
    this.#teardownSocket();
    this.status = "connecting";
    // Fresh connection: don't let the first sample's delta (measured against a
    // pre-reconnect timestamp) whip the cadence estimate.
    this.#lastSampleT = null;
    const ws = api.ws.metrics.subscribe();
    ws.subscribe((message: { data: unknown }) => {
      if (this.#ws !== ws) return; // superseded socket flushing late
      const sample = message.data as LiveSample;
      this.latest = sample;
      this.status = "live";
      const t = new Date(sample.time).getTime();
      // Track the real spacing between samples so consumers can size their glide
      // to the live feed. EMA (α=0.3) so one late/early sample nudges rather than
      // whips it; clamp to the config's allowed poll range to reject backfill
      // jumps and clock skew.
      if (this.#lastSampleT !== null) {
        const delta = t - this.#lastSampleT;
        if (delta > 0) {
          const clamped = Math.min(3_600_000, Math.max(1000, delta));
          this.cadenceMs = this.cadenceMs * 0.7 + clamped * 0.3;
        }
      }
      this.#lastSampleT = t;
      const cutoff = t - WINDOW_MS;
      for (const [key, v] of Object.entries(sample.metrics)) {
        // One copy per metric per tick (new reference so consumers re-render):
        // slice off expired points from the front and append the new one. At a
        // 1 Hz feed this runs every second for every metric, so the old
        // spread + filter pair (two full copies each) was the main source of
        // GC pressure — periodic collection pauses showed up as animation hiccups.
        const prev = this.#series.get(key) ?? [];
        let start = 0;
        while (start < prev.length && prev[start]!.t < cutoff) start++;
        if (prev.length - start >= MAX_POINTS) start = prev.length - MAX_POINTS + 1;
        const next = prev.slice(start);
        next.push({ t, v });
        this.#series.set(key, next);
      }
    });
    ws.on("open", () => {
      if (this.#ws !== ws) return;
      this.#reconnectAttempts = 0; // healthy connection resets backoff
    });
    ws.on("close", () => {
      if (this.#ws !== ws) return; // intentional/superseded close — don't retry
      this.#ws = null;
      this.status = "connecting";
      this.#scheduleReconnect();
    });
    // Surface transport errors as a close so the single reconnect path handles them.
    ws.on("error", () => ws.close());
    this.#ws = ws;
  }

  /** Reconnect after an unexpected drop: backfill the gap, then reopen the stream. */
  async #reconnect(): Promise<void> {
    if (!this.#started) return;
    // Backfill first so the buffers land on the newest data; nothing stale is
    // queued because the socket was closed while we were away.
    await this.#backfill();
    if (!this.#started) return;
    this.#connect();
  }

  #scheduleReconnect(): void {
    if (this.#reconnectTimer !== null || !this.#started) return;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.#reconnectAttempts);
    this.#reconnectAttempts += 1;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      void this.#reconnect();
    }, delay);
  }

  #clearReconnectTimer(): void {
    if (this.#reconnectTimer !== null) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
  }

  /** Close the current socket without scheduling a reconnect (identity-guarded). */
  #teardownSocket(): void {
    const ws = this.#ws;
    this.#ws = null; // clear first so the socket's close handler no-ops
    ws?.close();
  }

  /** Close the stream and detach listeners (call on shell teardown). */
  stop(): void {
    this.#clearReconnectTimer();
    this.#teardownSocket();
    if (this.#onVisibility && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.#onVisibility);
      this.#onVisibility = null;
    }
    this.#started = false;
    this.status = "closed";
  }
}

export const inverter = new InverterStore();

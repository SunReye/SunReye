import { SvelteMap } from "svelte/reactivity";
import { api } from "$lib/api";
import { uiPrefs } from "$lib/ui-prefs.svelte";
import { ReconnectingSocket } from "$lib/ws/reconnecting-socket";
import { CadenceTracker } from "./cadence";
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

type Status = "idle" | "connecting" | "live" | "closed";

/**
 * Index of the first point still inside the trailing window, also enforcing the
 * hard cap so a buffer can never grow past {@link MAX_POINTS}.
 */
function firstLiveIndex(points: LivePoint[], cutoff: number): number {
  let start = 0;
  while (start < points.length && points[start]!.t < cutoff) start++;
  if (points.length - start >= MAX_POINTS) return points.length - MAX_POINTS + 1;
  return start;
}

/** Group raw history rows into per-metric point lists, in row order. */
function groupRows(
  rows: readonly { metric: string; time: string; value: number }[],
): Map<string, LivePoint[]> {
  const byMetric = new Map<string, LivePoint[]>();
  for (const row of rows) {
    const points = byMetric.get(row.metric) ?? [];
    points.push({ t: new Date(row.time).getTime(), v: row.value });
    byMetric.set(row.metric, points);
  }
  return byMetric;
}

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
  /** The estimate itself — plain TS so the arithmetic is unit-testable. */
  #cadence = new CadenceTracker();

  // Reactive map: metric key → recent points. Plain `Map` in `$state` is NOT
  // reactive on get/set — SvelteMap tracks per-key mutations so sparklines
  // update the instant a new point lands.
  #series = new SvelteMap<string, LivePoint[]>();
  #started = false;
  #onVisibility: (() => void) | null = null;

  /** Releases the live-stream lease; null while no stream is leased. */
  #release: (() => void) | null = null;

  #socket = new ReconnectingSocket({
    create: () => api.ws.metrics.subscribe(),
    // Runs before every (re)connect, and the socket waits on it: seed the
    // buffers with the newest rows so they land on current data instead of
    // replaying the gap, and only then start listening. Nothing stale is queued
    // behind it because the socket was closed while we were away.
    onStart: async (stillWanted) => {
      await this.#backfill();
      // The fetch outlives its connection attempt when the tab hides or `stop()`
      // runs mid-flight: those paths released the lease and wrote their own
      // status, and no socket will follow this backfill. Everything below is
      // per-connection state for a connection that will never exist.
      if (!stillWanted()) return;
      this.status = "connecting";
      // Fresh connection: don't let the first sample's delta (measured against a
      // pre-reconnect timestamp) whip the cadence estimate. After the await, with
      // the status: the reset belongs to the connection this start is opening, so
      // an abandoned attempt must not perform it either — the seed it would leave
      // behind is one the next start re-applies anyway.
      this.#cadence.reset();
    },
    onMessage: (raw) => {
      const sample = raw as LiveSample;
      this.latest = sample;
      this.status = "live";
      const t = new Date(sample.time).getTime();
      this.cadenceMs = this.#cadence.sample(t);
      const cutoff = t - WINDOW_MS;
      for (const [key, v] of Object.entries(sample.metrics)) {
        this.#appendPoint(key, { t, v }, cutoff);
      }
    },
    // A drop is a reconnect in progress. The socket also reports one when the
    // last lease goes away (hide/stop); this hook runs synchronously inside that
    // release, so the "idle"/"closed" those paths write lands after it and
    // "connecting" never sticks on a stream nobody wants. The reopen path is not
    // symmetric — `onStart` is async, which is why it re-checks `stillWanted()`
    // before writing a status of its own.
    onDrop: () => {
      this.status = "connecting";
    },
  });

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
      // Releasing the last lease closes the socket and cancels any armed
      // backoff, so the return path opens immediately instead of waiting one
      // out.
      this.#release?.();
      this.#release = null;
      this.status = "idle";
      return;
    }
    this.#lease();
  }

  /** Take the stream lease (idempotent — one lease per store). */
  #lease(): void {
    if (!this.#started || this.#release !== null) return;
    this.#release = this.#socket.connect();
  }

  async #init(): Promise<void> {
    // Load visibility prefs so the metric getter filters from the first render;
    // fire-and-forget — a default (nothing hidden) is the safe fallback and the
    // reactive getter re-filters once it resolves.
    void uiPrefs.load();
    await this.#loadManifest();
    // Lease the stream; the socket backfills the sparklines in `onStart` before
    // it opens, so the buffers are populated on load and appended to from here.
    this.#lease();
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
    for (const [key, points] of groupRows(data)) this.#seedSeries(key, points);
  }

  /** Rows arrive newest-first; sort ascending and keep the trailing window. */
  #seedSeries(key: string, points: LivePoint[]): void {
    points.sort((a, b) => a.t - b.t);
    this.#series.set(key, this.#trim(this.#downsampleToHz(points)));
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

  /**
   * Append one metric's new sample and drop what fell out of the window. One copy
   * per metric per tick (new reference so consumers re-render): slice off expired
   * points from the front, then append. At a 1 Hz feed this runs every second for
   * every metric, so the old spread + filter pair (two full copies each) was the
   * main source of GC pressure — collection pauses showed up as animation hiccups.
   */
  #appendPoint(key: string, point: LivePoint, cutoff: number): void {
    const prev = this.#series.get(key) ?? [];
    const next = prev.slice(firstLiveIndex(prev, cutoff));
    next.push(point);
    this.#series.set(key, next);
  }

  /** Close the stream and detach listeners (call on shell teardown). */
  stop(): void {
    this.#release?.();
    this.#release = null;
    if (this.#onVisibility && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.#onVisibility);
      this.#onVisibility = null;
    }
    this.#started = false;
    this.status = "closed";
  }
}

export const inverter = new InverterStore();

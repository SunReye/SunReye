import { untrack } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import { api } from "$lib/api";
import { uiPrefs } from "$lib/ui-prefs.svelte";
import { bus } from "$lib/ws/bus.svelte";
import { backfillSeconds, isFullBackfill, LiveSeries, MetricsFeed } from "./live-metrics";
import type {
  CanonicalRole,
  InverterCapabilities,
  InverterManifest,
  LivePoint,
  LiveSample,
  ManifestMetric,
} from "./types";

/**
 * Single source of truth for the active inverter on the client. Holds the
 * capability manifest (fetched once) and the live sample stream, plus small
 * per-metric ring buffers so KPI cards can draw live sparklines. Everything the
 * UI renders is keyed off `manifest` — no vendor-specific code lives here.
 *
 * Transport is not this store's business: samples arrive on the `metrics` topic
 * of the app's one live socket, which the shell leases. Reconnect replay, the
 * pre-open send queue and frame parsing all live in the bus; the mechanism that
 * is left — the ring buffers and the backfill-before-frames ordering — lives in
 * `live-metrics.ts`, plain TS so it can be tested. What remains here is the
 * reactive surface and the manifest.
 */
class InverterStore {
  manifest = $state<InverterManifest | null>(null);
  latest = $state<LiveSample | null>(null);
  /**
   * Which device this store describes; `null` is the plant's default, which is
   * what every install with one device has and what the server answers when a
   * request names none.
   */
  deviceId = $state<string | null>(null);

  // Reactive map: metric key → recent points. Plain `Map` in `$state` is NOT
  // reactive on get/set — SvelteMap tracks per-key mutations so sparklines
  // update the instant a new point lands.
  #series = new SvelteMap<string, LivePoint[]>();
  #live = new LiveSeries(this.#series);
  #started = false;
  #onVisibility: (() => void) | null = null;

  #feed = new MetricsFeed({
    backfill: () => this.#backfill(),
    subscribe: (on) => bus.subscribe("metrics", on),
    onSample: (sample) => {
      this.latest = sample;
      this.#live.appendSample(sample);
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

  /**
   * Fetch the manifest and lease the `metrics` topic; the returned disposer
   * gives the topic back and detaches the visibility listener. Held once, by the
   * app shell, alongside its lease on the socket itself. Idempotent — a second
   * call while leased is a no-op that returns the same release.
   */
  start(): () => void {
    if (this.#started) return () => {};
    this.#started = true;
    if (typeof document !== "undefined") {
      this.#onVisibility = () => this.#feed.setHidden(document.visibilityState === "hidden");
      document.addEventListener("visibilitychange", this.#onVisibility);
    }
    // Load visibility prefs so the metric getter filters from the first render;
    // fire-and-forget — a default (nothing hidden) is the safe fallback and the
    // reactive getter re-filters once it resolves.
    void uiPrefs.load();
    void this.#loadManifest();
    // The lease seeds the sparklines from history before it takes the topic, so
    // the buffers are populated on load and appended to from there.
    const release = this.#feed.lease();
    return () => {
      release();
      this.#detachVisibility();
      this.#started = false;
    };
  }

  #detachVisibility(): void {
    if (!this.#onVisibility || typeof document === "undefined") return;
    document.removeEventListener("visibilitychange", this.#onVisibility);
    this.#onVisibility = null;
  }

  /**
   * Point this store at another device.
   *
   * Everything held is the previous machine's, so it goes first: the last
   * sample, the sparkline buffers, and the manifest that decodes them. A
   * dashboard that kept any of it would render one device's catalog against
   * another's readings — and `latest` in particular would keep painting numbers
   * that look perfectly current.
   *
   * Called from an event handler, never from the shell's `$effect`: making that
   * effect depend on the selection would tear down and re-lease the socket on
   * every switch, which is the restart loop the backfill comment describes.
   */
  async switchTo(deviceId: string | null): Promise<void> {
    if (deviceId === this.deviceId) return;
    this.deviceId = deviceId;
    this.latest = null;
    this.#live.clear();
    // Re-points the live topic; the server leaves the old device's channel
    // before joining the new one.
    bus.setDevice(deviceId);
    // Re-runs the backfill for the new device, and holds frames off until it
    // lands so an in-flight frame from the old one is not applied.
    this.#feed.restart();
    await this.#loadManifest();
  }

  async #loadManifest(): Promise<void> {
    const { data } = await api.api.profile.get(
      this.deviceId === null ? {} : { query: { deviceId: this.deviceId } },
    );
    if (data) this.manifest = data as unknown as InverterManifest;
  }

  /**
   * Seed the sparkline buffers from history. This is *not* a prime for the live
   * stream — the `metrics` topic carries no server snapshot, because the 5-minute
   * window is rows in the database rather than something the socket holds — so it
   * cannot race one. It runs before the topic's first frame, and again whenever
   * the tab comes back, so the buffers land on current data.
   */
  async #backfill(): Promise<void> {
    // Ask only for what is actually missing. On first load nothing is held, so
    // this is the whole window; on a resume after a short hide it is the gap
    // plus a small overlap — by far the most frequent case, and previously the
    // full 5-minute refetch. The endpoint buckets server-side and answers in a
    // compact offset encoding, so there is no client row cap to pick any more:
    // the row count is bounded by window ÷ step, per metric.
    //
    // UNTRACKED, and this is load-bearing rather than an optimisation.
    // `newestHeldMs` walks the `SvelteMap` of buffers, and `lease()` calls this
    // synchronously from inside the shell's `$effect` (see `(app)/+layout.svelte`
    // — the await chain has not suspended yet at this line). A tracked read there
    // makes the effect depend on the very map that `seedBackfill`/`mergeBackfill`
    // and every live frame then WRITE: the effect invalidates, its cleanup
    // releases the socket and the metrics lease, it re-runs, re-leases, re-fetches
    // and writes again. That shipped, and it was a hot restart loop — ~12 cycles a
    // second of `/api/profile` + `/api/history/recent`, a socket closed before it
    // could finish opening, and `#consuming` never latching, so not one live frame
    // was ever applied and every reading on the dashboard rendered as an em dash.
    // The gap width is an input to a fetch, never a reason to re-run the shell.
    const seconds = backfillSeconds(
      untrack(() => this.#live.newestHeldMs()),
      Date.now(),
    );
    const { data } = await api.api.history.recent.get({
      // Named, so the sparklines behind a switched-to device are its own rows
      // rather than the default device's.
      query:
        this.deviceId === null
          ? { seconds, stepSeconds: 1 }
          : { seconds, stepSeconds: 1, inverterId: this.deviceId },
    });
    if (!data) return;
    // A full-width request is authoritative about the window and replaces the
    // buffers; a gap request only describes the gap and merges. The predicate is
    // `isFullBackfill` rather than an inline comparison so the suite exercises
    // THIS branch instead of a copy of it.
    if (isFullBackfill(seconds)) this.#live.seedBackfill(data);
    else this.#live.mergeBackfill(data);
  }
}

export const inverter = new InverterStore();

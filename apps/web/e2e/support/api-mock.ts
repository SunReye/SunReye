/**
 * The whole backend, faked in the browser.
 *
 * A spec that needs Postgres, TimescaleDB and a live inverter is a spec nobody
 * runs. Every HTTP call the app makes is answered by `page.route`, and the one
 * multiplexed live socket is served by `page.routeWebSocket`, so `bun run e2e`
 * needs nothing but a browser and the dev server.
 *
 * The contracts here are copied from the real ones, not guessed:
 *   - the boot sequence is `(app)/+layout.svelte`
 *   - the socket vocabulary is `packages/contracts/src/ws/index.ts`
 *     (`{t:"sub"|"unsub"}` up, `{topic,data}` down, `__ack` in between)
 *   - the backfill shape is `RecentBackfill` in `src/lib/inverter/live-metrics.ts`
 *   - the rollup row shape is `queryRollup` in `apps/server/src/shared/history.ts`
 *   - the manifest is a REAL 105-metric Deye profile, run through
 *     `buildManifest` and committed as `e2e/fixtures/manifest.json`
 *
 * If the app grows a call this file does not answer, {@link MockBackend.unhandled}
 * names it and the smoke spec fails — a missing stub otherwise shows up as a
 * page that silently never leaves its first-run gate.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page, Route, WebSocketRoute } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));

/** A metric as `/api/profile` serves it. */
export interface FixtureMetric {
  key: string;
  label: string;
  unit: string | null;
  group: string;
  kind: string;
  writable: boolean;
  role?: string;
  index?: number;
  flow?: string;
}

export interface FixtureManifest {
  id: string;
  name: string;
  manufacturer: string;
  capabilities: Record<string, unknown>;
  metrics: FixtureMetric[];
}

/** The committed manifest — a real Deye SG05LP3 profile. */
export const MANIFEST = JSON.parse(
  readFileSync(join(here, "..", "fixtures", "manifest.json"), "utf8"),
) as FixtureManifest;

/** Only measurement/cumulative metrics get a card (see `ranges.ts#isChartable`). */
export const CHARTABLE_METRIC_COUNT = MANIFEST.metrics.filter(
  (m) => m.kind === "measurement" || m.kind === "cumulative",
).length;

/** Every metric key the fake inverter publishes. */
export const METRIC_KEYS = MANIFEST.metrics.map((m) => m.key);

export interface BackendOptions {
  /**
   * Milliseconds between automatic live frames. Production polls at 1 Hz and
   * the page is built around that cadence, so it is the default. `0` disables
   * the timer entirely and the spec drives the feed with
   * {@link MockBackend.pushMetrics}.
   */
  feedIntervalMs?: number;
  /**
   * Rows one `/api/history/rollup` answer carries. The measured production
   * cost of a preset range is ~1876 rows per card, which is what makes chart
   * construction the dominant term.
   */
  rollupRows?: number;
  /**
   * Seconds between points in the `/api/history/recent` backfill. The real
   * plant stores a sample every ten seconds, which is what puts the payload at
   * the measured ~54 KB for a hundred-odd metrics.
   */
  backfillStrideSeconds?: number;
  /** Signed-in role. `null` serves a logged-out visitor. */
  role?: "admin" | "user" | null;
  /** Whether the anonymous read-only dashboard is enabled (only read when logged out). */
  publicDashboard?: boolean;
}

export interface MockBackend {
  /** The manifest this instance serves. */
  readonly manifest: FixtureManifest;
  /** Paths of every intercepted API request, in order. */
  readonly requests: readonly string[];
  /** API paths no stub answered — must stay empty. */
  readonly unhandled: readonly string[];
  /** Control frames the client wrote to the live socket, parsed. */
  readonly clientFrames: readonly unknown[];
  /** How many times the app opened the live socket. More than one is a bug. */
  readonly socketOpens: number;
  /** How many requests so far match `pattern` (substring, or regex). */
  requestCount(pattern: string | RegExp): number;
  /** Forget the request log — call before a `countRequests` window. */
  resetRequests(): void;
  /** Resolve once the socket is open and has subscribed to `metrics`. */
  waitForLive(timeoutMs?: number): Promise<void>;
  /** Send exactly one `metrics` frame, optionally forcing some values. */
  pushMetrics(overrides?: Record<string, number>): Promise<void>;
  /** Drop the socket, as a network blip would. The app reconnects on its own. */
  dropSocket(): Promise<void>;
  /** Stop the automatic feed (idempotent; also runs at test end). */
  stopFeed(): void;
}

/** Deterministic PRNG — a perf number that moves because of the fixture is noise. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Stable small integer from a string, so each metric gets its own shape. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  }
  return (h >>> 0) % 1000;
}

/** A plausible engineering-unit value for a metric at tick `t`. */
function valueFor(metric: FixtureMetric, t: number): number {
  const base = hash(metric.key);
  const swing = Math.sin((t + base) / 7) * 0.5 + 0.5;
  if (metric.unit === "%") return Math.round(swing * 100 * 10) / 10;
  if (metric.unit === "V") return Math.round((220 + swing * 20) * 10) / 10;
  if (metric.unit === "A") return Math.round(swing * 32 * 10) / 10;
  if (metric.unit === "Hz") return Math.round((49.9 + swing * 0.2) * 100) / 100;
  if (metric.unit === "°C") return Math.round((20 + swing * 25) * 10) / 10;
  if (metric.unit === "kWh") return Math.round((base + t / 3600) * 100) / 100;
  if (metric.unit === "W") return Math.round((swing - 0.3) * 4000);
  return Math.round(swing * 100 * 10) / 10;
}

/** JSON response with the content type Eden needs to parse it. */
function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

/** The `/api/history/recent` payload: `{ t0, step, metrics: { key: { o, v } } }`. */
function backfillBody(seconds: number, stepSeconds: number, strideSeconds: number) {
  const now = Date.now();
  const t0 = now - seconds * 1000;
  const stride = Math.max(1, Math.round(strideSeconds / stepSeconds));
  const count = Math.max(1, Math.floor(seconds / stepSeconds / stride));
  const metrics: Record<string, { o: number[]; v: number[] }> = {};
  for (const metric of MANIFEST.metrics) {
    const o: number[] = [];
    const v: number[] = [];
    for (let i = 0; i < count; i++) {
      const offset = i * stride;
      o.push(offset);
      v.push(valueFor(metric, offset * stepSeconds));
    }
    metrics[metric.key] = { o, v };
  }
  return { t0, step: stepSeconds, metrics };
}

/** One rollup series across `[from, to)`, in the ascending order charts expect. */
function rollupRows(from: number, to: number, rows: number, seed: number) {
  const random = lcg(seed + 1);
  const span = Math.max(1, to - from);
  const out: { time: string; avg: number; min: number; max: number }[] = [];
  for (let i = 0; i < rows; i++) {
    const at = from + Math.round((span * i) / rows);
    const wave = Math.sin((i / rows) * Math.PI * 6 + seed) * 1500;
    const avg = Math.round(wave + (random() - 0.5) * 300);
    out.push({
      time: new Date(at).toISOString(),
      avg,
      min: avg - Math.round(random() * 250),
      max: avg + Math.round(random() * 250),
    });
  }
  return out;
}

const SESSION_USER = {
  id: "e2e-user",
  name: "E2E Admin",
  email: "e2e@example.com",
  emailVerified: true,
  image: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

/**
 * Install the fake backend on `page`. Call it BEFORE `page.goto` — the routes
 * have to be in place for the very first request the shell makes.
 */
export async function mockBackend(page: Page, options: BackendOptions = {}): Promise<MockBackend> {
  const feedIntervalMs = options.feedIntervalMs ?? 1000;
  const rows = options.rollupRows ?? 1876;
  const stride = options.backfillStrideSeconds ?? 10;
  const role = options.role === undefined ? "admin" : options.role;

  const requests: string[] = [];
  const unhandled: string[] = [];
  const clientFrames: unknown[] = [];
  let sockets: WebSocketRoute[] = [];
  let socketOpens = 0;
  let subscribed = new Set<string>();
  let tick = 0;
  let feed: ReturnType<typeof setInterval> | null = null;
  // One body per (window, series) pair: every card on a page asks for the same
  // window, so generating 1876 rows sixty-three times would measure the mock.
  const rollupCache = new Map<string, string>();

  function sendFrame(topic: string, data: unknown): void {
    const text = JSON.stringify({ topic, data });
    for (const ws of sockets) ws.send(text);
  }

  function sample(overrides: Record<string, number> = {}) {
    tick += 1;
    const metrics: Record<string, number> = {};
    for (const metric of MANIFEST.metrics) metrics[metric.key] = valueFor(metric, tick);
    Object.assign(metrics, overrides);
    return { time: new Date().toISOString(), inverterId: MANIFEST.id, metrics };
  }

  function handleClientFrame(raw: string): void {
    let frame: { t?: string; topics?: string[] };
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    clientFrames.push(frame);
    const topics = frame.topics ?? [];
    if (frame.t === "sub") {
      for (const topic of topics) subscribed.add(topic);
      sendFrame("__ack", { subscribed: topics, denied: [] });
      // The first frame lands immediately, the way a live plant's next poll
      // would: a page that waits a whole second for its first number measures
      // the wait, not the page.
      if (subscribed.has("metrics")) sendFrame("metrics", sample());
    } else if (frame.t === "unsub") {
      for (const topic of topics) subscribed.delete(topic);
    }
  }

  await page.routeWebSocket("**/ws", (ws) => {
    socketOpens += 1;
    sockets.push(ws);
    ws.onMessage((message) => {
      handleClientFrame(typeof message === "string" ? message : message.toString());
    });
    ws.onClose(() => {
      sockets = sockets.filter((s) => s !== ws);
    });
  });

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    requests.push(path + url.search);

    // ── Auth ────────────────────────────────────────────────────────────────
    if (path.endsWith("/api/auth/get-session")) {
      if (!role) return json(route, null);
      return json(route, {
        session: { id: "e2e-session", userId: SESSION_USER.id, token: "e2e" },
        user: { ...SESSION_USER, role },
      });
    }
    if (path.includes("/api/auth/")) return json(route, null);

    // ── Boot gates ──────────────────────────────────────────────────────────
    if (path.endsWith("/api/setup-status")) return json(route, { needsSetup: false });
    if (path.endsWith("/api/profile-status")) {
      return json(route, { needsProfile: false, activeProfileId: MANIFEST.id });
    }
    if (path.endsWith("/api/access-status")) {
      return json(route, { publicDashboard: options.publicDashboard ?? false });
    }

    // ── Instance settings the shell loads before it renders ─────────────────
    if (path.endsWith("/api/settings/ui")) return json(route, { hiddenKeys: [], hiddenGroups: [] });
    if (path.endsWith("/api/settings/display")) {
      return json(route, { hourCycle: "24h", timeZone: "Europe/Berlin" });
    }
    if (path.endsWith("/api/settings/chart-palette")) return json(route, { preset: "categorical" });

    // ── The catalogue ───────────────────────────────────────────────────────
    if (path.endsWith("/api/profile")) return json(route, MANIFEST);
    if (path.endsWith("/api/custom-charts")) return json(route, []);

    // ── Time series ─────────────────────────────────────────────────────────
    if (path.endsWith("/api/history/recent")) {
      const seconds = Number(url.searchParams.get("seconds") ?? 300);
      const step = Number(url.searchParams.get("stepSeconds") ?? 1);
      return json(route, backfillBody(seconds, step, stride));
    }
    if (path.endsWith("/api/history/rollup")) {
      const metric = url.searchParams.get("metric") ?? "";
      const from = Date.parse(url.searchParams.get("from") ?? "") || Date.now() - 3600_000;
      const to = Date.parse(url.searchParams.get("to") ?? "") || Date.now();
      // Eight distinct series, shared out by metric key: enough that the page
      // does not look like one chart repeated, cheap enough to cache.
      const seed = hash(metric) % 8;
      const key = `${from}|${to}|${rows}|${seed}`;
      let body = rollupCache.get(key);
      if (!body) {
        body = JSON.stringify(rollupRows(from, to, rows, seed));
        rollupCache.set(key, body);
      }
      return route.fulfill({ status: 200, contentType: "application/json", body });
    }
    if (path.endsWith("/api/history")) return json(route, []);

    // Anything else is a contract this fixture has not been taught. Recorded
    // rather than silently 404'd into a blank page.
    unhandled.push(path);
    return json(route, {}, 404);
  });

  function stopFeed(): void {
    if (feed) clearInterval(feed);
    feed = null;
  }

  if (feedIntervalMs > 0) {
    feed = setInterval(() => {
      if (subscribed.has("metrics")) sendFrame("metrics", sample());
    }, feedIntervalMs);
    // Node would keep the process alive on this timer alone.
    feed.unref?.();
  }
  page.on("close", stopFeed);

  const backend: MockBackend = {
    manifest: MANIFEST,
    get requests() {
      return requests;
    },
    get unhandled() {
      return unhandled;
    },
    get clientFrames() {
      return clientFrames;
    },
    get socketOpens() {
      return socketOpens;
    },
    requestCount(pattern) {
      return requests.filter((r) =>
        typeof pattern === "string" ? r.includes(pattern) : pattern.test(r),
      ).length;
    },
    resetRequests() {
      requests.length = 0;
    },
    async waitForLive(timeoutMs = 20_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (sockets.length > 0 && subscribed.has("metrics")) return;
        await page.waitForTimeout(50);
      }
      // Summarise rather than dump. A shell stuck in a re-lease loop sends
      // thousands of identical frames, and printing them buries the one number
      // that names the fault — `opens` — under 100KB of scrollback.
      const shown = clientFrames.slice(0, 5).map((f) => JSON.stringify(f));
      const more = clientFrames.length - shown.length;
      const churn =
        socketOpens > 1
          ? ` — the socket was opened ${socketOpens} times, so the shell is tearing its own connection down (see e2e/shell-lease-loop.spec.ts)`
          : "";
      throw new Error(
        `live socket never subscribed to "metrics" (opens=${socketOpens}, ` +
          `${clientFrames.length} client frames: ${shown.join(", ")}` +
          `${more > 0 ? `, +${more} more` : ""})${churn}`,
      );
    },
    async pushMetrics(overrides) {
      if (sockets.length === 0)
        throw new Error("pushMetrics: no live socket — await waitForLive()");
      sendFrame("metrics", sample(overrides));
      // Let the frame cross the boundary and the render flush before returning.
      await page.waitForTimeout(0);
    },
    async dropSocket() {
      const open = sockets;
      sockets = [];
      subscribed = new Set();
      for (const ws of open) await ws.close();
    },
    stopFeed,
  };
  return backend;
}

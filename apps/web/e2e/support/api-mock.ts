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
 *
 * This file is the ROUTING table: which method and path gets which body, and
 * what the live socket does on subscribe. The bodies themselves live in
 * `api-fixtures.ts`, each one next to the contract it copies.
 *
 * Two things it did wrong for a long time, worth knowing because the fix is
 * load-bearing:
 *
 *   - Nothing read `route.request().method()`. `POST /api/custom-charts` (a
 *     chart being CREATED) therefore matched the GET handler and resolved to
 *     `[]`, and every other PUT/POST/DELETE in the app fell through to the
 *     catch-all. Every handler below is now keyed on method first.
 *   - The socket acked every topic with `denied: []`. The server denies `logs`
 *     and `automations` to a non-admin session, so a spec about that gate would
 *     have passed against a broken build. {@link BackendOptions.role} now
 *     drives the same denial.
 *   - `allows()` then ended in `return true`, so every topic name it did not
 *     recognise was GRANTED — under a comment saying the client may ask for one
 *     the server has never heard of. The server denies those by name
 *     (`ws-subscribe.ts`), and now so does this.
 *   - Every `PUT` echoed the request body. The server answers with the value it
 *     PARSED, so a save could read back a config missing defaults the real
 *     server always fills in; see {@link saved}.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page, Route, WebSocketRoute } from "@playwright/test";
import * as fixture from "./api-fixtures";

const here = dirname(fileURLToPath(import.meta.url));

/** A metric as `/api/profile` serves it. */
export interface FixtureMetric {
  key: string;
  label: string;
  unit: string | null;
  group: string;
  kind: string;
  /** Where the server persists it — mirrors `resolveStorage` in inverter-core. */
  storage?: string;
  enumLabels?: Record<string, string>;
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

/**
 * Metrics that get a card, mirroring `ranges.ts#isChartable`: not excluded from
 * the timeseries table, and not a state. Derived from the manifest rather than
 * pinned, so re-recording the fixture cannot silently drift from the app.
 */
export const CHARTABLE_METRIC_COUNT = MANIFEST.metrics.filter(
  (m) => m.storage !== "config" && m.storage !== "none" && m.kind !== "status" && !m.enumLabels,
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
  /**
   * `/api/setup-status`. `true` is the first-run instance with no admin account
   * yet — the ONLY state in which `/#/onboarding` renders instead of bouncing
   * to `/#/login`.
   */
  needsSetup?: boolean;
  /**
   * `/api/profile-status`. `true` is an instance with an admin but no active
   * inverter profile — the only state in which `/#/setup` renders instead of
   * bouncing to `/#/`. Must be paired with `needsSetup: false`, or the setup
   * page's own gate sends it on to onboarding.
   */
  needsProfile?: boolean;
  /**
   * `/api/weather`. `"reading"` (default) is a full, readable reading;
   * `null` is weather switched off, which the server answers with an EMPTY
   * BODY — the case `payloadOrNull` exists for, and the case in which the tile
   * renders nothing at all.
   */
  weather?: "reading" | null;
  /**
   * `/api/prices` + `/api/statistics/prices`. `null` is "no price feed
   * configured": both answer with an empty body and the whole prices section
   * disappears.
   */
  prices?: "view" | null;
  /** `evcc` topic payload. `null` is ingest disabled — the EV card self-hides. */
  evcc?: "state" | null;
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
  /**
   * Send one frame on any other topic. The non-`metrics` topics are backfilled
   * once at subscribe time (as the server does); these drive the LIVE path,
   * which is the only thing /#/settings/logs has, and the only way a spec can
   * watch a value CHANGE rather than merely arrive.
   */
  pushEvcc(state?: unknown): Promise<void>;
  pushAutomations(message?: unknown): Promise<void>;
  pushLogs(entries?: unknown[]): Promise<void>;
  /** Topics the socket refused, as the ack reported them. */
  readonly deniedTopics: readonly string[];
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

/**
 * A 200 with NO body and no content type — how Elysia serialises a handler that
 * returned `null`.
 *
 * This is not a nicety. Eden hands an empty body back as `""`, and `""` is not
 * nullish, so `data ?? null` keeps it and every downstream `if (data)` passes
 * on a feature that is switched off. `json(route, null)` sends the four
 * characters `null`, which parses to `null` and takes a DIFFERENT branch — so a
 * fixture that used it would never exercise the guard (`src/lib/api-payload.ts`)
 * that exists for this exact response.
 */
function emptyBody(route: Route): Promise<void> {
  return route.fulfill({ status: 200, body: "" });
}

/**
 * A settings save's response body.
 *
 * The server never echoes what it was handed: every `PUT /api/settings/*` runs
 * the body through its zod schema and answers with the PARSED value (see
 * `apps/server/src/routes/settings.ts`), so defaults are filled in and unknown
 * keys are stripped. A raw echo lets a form post a partial patch and read back
 * a config missing keys the real server always supplies — the panel then
 * renders empty inputs on a successful save.
 *
 * Shallow, deliberately: every form in this app posts whole nested groups
 * (`tariff.import`, `weather.forecast`), so a deep merge would only paper over
 * a partial post the server itself would have rejected.
 */
function saved<T extends object>(defaults: T, patch: Record<string, unknown>): T {
  return { ...defaults, ...patch };
}

const nowIso = (): string => new Date().toISOString();
const isoAgo = (ms: number): string => new Date(Date.now() - ms).toISOString();

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
  const subscribed = new Set<string>();
  const denied: string[] = [];
  const evccSnapshot = options.evcc === null ? null : fixture.EVCC_STATE;
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

  /**
   * The subscribe-time backfill, per topic — `apps/server/src/routes/ws-backfill.ts`.
   *
   * The server pointedly does NOT backfill `metrics` (pinned by
   * `ws-backfill.test.ts`); this fixture does, as a first-paint accelerator, so
   * a page under test does not spend a whole second showing em dashes. Every
   * other topic here mirrors the server: a page that gates on `loaded` (the
   * automations stream does) never leaves its skeleton without one.
   */
  function backfill(topic: string): void {
    if (topic === "metrics") return sendFrame("metrics", sample());
    if (topic === "evcc") {
      // No snapshot means NO FRAME, not a frame carrying `null`: `ws-priming.ts`
      // documents "`undefined`/`null` means there is nothing to send", and
      // `evccSnapshot()` answers null until EVCC's first MQTT message. A
      // `{topic:"evcc",data:null}` is a frame production cannot emit.
      if (evccSnapshot === null) return;
      return sendFrame("evcc", evccSnapshot);
    }
    if (topic === "statistics") return sendFrame("statistics", fixture.statisticsToday());
    if (topic === "automations") return sendFrame("automations", fixture.automationStream());
    // `logs`: the server backfills `recentLogs()` only when the ring is
    // non-empty, and a freshly-booted engine's is empty. Drive it with
    // `pushLogs()` — the live path is the whole feature on that page.
  }

  /**
   * The wire's topic set and each one's gate — `TOPIC_POLICY` in
   * `apps/server/src/routes/ws-topics.ts`, restated.
   *
   * A name that is not a key here is not a topic at all, and the server refuses
   * it by name (`ws-subscribe.ts`: `isWsTopic(requested) && allows(...)`, else
   * `denied.push(name)`). This table used to end in `return true`, so the mock
   * GRANTED every topic it had never heard of — under a comment saying the
   * client may ask for one — and a client typo would have been a passing test.
   */
  const TOPIC_POLICY: Record<string, "dashboard" | "admin"> = {
    metrics: "dashboard",
    evcc: "dashboard",
    statistics: "dashboard",
    logs: "admin",
    automations: "admin",
  };

  /**
   * Topics this session may hold. `admin` never rides the public-dashboard
   * exemption; `dashboard` is any session, or anonymous when it is on.
   */
  function allows(topic: string): boolean {
    const policy = TOPIC_POLICY[topic];
    if (policy === undefined) return false;
    return policy === "admin" ? role === "admin" : true;
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
      const granted = topics.filter(allows);
      const refused = topics.filter((topic) => !allows(topic));
      for (const topic of granted) subscribed.add(topic);
      for (const topic of refused) if (!denied.includes(topic)) denied.push(topic);
      // `denied` is `string[]` on the wire, not `WsTopic[]` — on purpose: an
      // unknown name is refused BY NAME rather than dropped, which is how the
      // client learns its typo was not simply ignored.
      sendFrame("__ack", { subscribed: granted, denied: refused });
      for (const topic of granted) backfill(topic);
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
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname;
    const query = Object.fromEntries(url.searchParams);
    requests.push(path + url.search);
    /** The request body, for the routes that echo what they were given. */
    const body = (): Record<string, unknown> =>
      (request.postDataJSON() as Record<string, unknown> | null) ?? {};
    /** The last path segment — `:id` for the by-id routes. */
    const id = path.slice(path.lastIndexOf("/") + 1);
    const at = (suffix: string): boolean => path.endsWith(`/api/${suffix}`);
    const under = (prefix: string): boolean => path.includes(`/api/${prefix}/`);

    // ── Auth ────────────────────────────────────────────────────────────────
    if (at("auth/get-session")) {
      if (!role) return json(route, null);
      return json(route, {
        session: { id: "e2e-session", userId: SESSION_USER.id, token: "e2e" },
        user: { ...SESSION_USER, role },
      });
    }
    // Better Auth's admin plugin. These used to be swallowed by the `/api/auth/`
    // catch-all below, which answers `null` — so /#/settings/users and
    // /#/settings/api-keys rendered a load-error toast over an empty table and
    // any assertion on either page was vacuous.
    if (at("auth/admin/list-users")) {
      return json(route, {
        users: [{ ...SESSION_USER, role: role ?? "user", banned: false }],
        total: 1,
        limit: Number(query.limit ?? 100),
        offset: 0,
      });
    }
    if (at("auth/admin/create-user")) {
      return json(route, { user: { ...SESSION_USER, id: "new-user", role: body().role } });
    }
    if (at("auth/admin/set-role")) {
      return json(route, { user: { ...SESSION_USER, role: body().role } });
    }
    if (at("auth/admin/remove-user")) return json(route, { success: true });
    if (at("auth/sign-in/email") || at("auth/sign-up/email")) {
      return json(route, { user: { ...SESSION_USER, role: role ?? "admin" }, token: "e2e" });
    }
    if (at("auth/sign-out")) return json(route, { success: true });
    if (path.includes("/api/auth/")) return json(route, null);

    // ── Boot gates ──────────────────────────────────────────────────────────
    // These three decide which of the 26 routes is even reachable: `(app)`'s
    // first-run gate reads them in this order and redirects on the first one
    // that is not satisfied.
    if (at("setup-status")) return json(route, { needsSetup: options.needsSetup ?? false });
    if (at("profile-status")) {
      return json(route, {
        needsProfile: options.needsProfile ?? false,
        activeProfileId: options.needsProfile ? null : MANIFEST.id,
      });
    }
    if (at("access-status")) {
      return json(route, { publicDashboard: options.publicDashboard ?? false });
    }

    // ── Instance settings the shell loads before it renders ─────────────────
    if (at("settings/ui")) {
      if (method === "PUT") return json(route, saved(fixture.UI_PREFS, body()));
      return json(route, fixture.UI_PREFS);
    }
    if (at("settings/display")) {
      if (method === "PUT") return json(route, saved(fixture.DISPLAY, body()));
      return json(route, fixture.DISPLAY);
    }
    if (at("settings/chart-palette")) {
      if (method === "PUT") return json(route, saved(fixture.CHART_PALETTE, body()));
      return json(route, fixture.CHART_PALETTE);
    }

    // ── Engine status (polled by every /settings/* route) ───────────────────
    if (at("status")) return json(route, fixture.status(MANIFEST));

    // ── The catalogue ───────────────────────────────────────────────────────
    if (at("profile")) return json(route, MANIFEST);
    if (at("custom-charts")) {
      // Branch on the METHOD: `endsWith` alone matched the create too, so a new
      // chart silently resolved to the empty list.
      if (method === "POST") {
        return json(route, { id: "chart-1", ...body() });
      }
      return json(route, []);
    }
    if (under("custom-charts")) {
      if (method === "DELETE") return json(route, { ok: true, id });
      return json(route, { id, ...body() });
    }

    // ── Time series ─────────────────────────────────────────────────────────
    if (at("history/recent")) {
      const seconds = Number(url.searchParams.get("seconds") ?? 300);
      const step = Number(url.searchParams.get("stepSeconds") ?? 1);
      return json(route, backfillBody(seconds, step, stride));
    }
    if (at("history/rollup")) {
      const metric = url.searchParams.get("metric") ?? "";
      const from = Date.parse(url.searchParams.get("from") ?? "") || Date.now() - 3600_000;
      const to = Date.parse(url.searchParams.get("to") ?? "") || Date.now();
      // Eight distinct series, shared out by metric key: enough that the page
      // does not look like one chart repeated, cheap enough to cache.
      const seed = hash(metric) % 8;
      const key = `${from}|${to}|${rows}|${seed}`;
      let cached = rollupCache.get(key);
      if (!cached) {
        cached = JSON.stringify(rollupRows(from, to, rows, seed));
        rollupCache.set(key, cached);
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: cached });
    }
    if (at("history")) return json(route, []);

    // ── Overview ────────────────────────────────────────────────────────────
    if (at("weather")) {
      // `null` here is weather switched off. Elysia sends that as an empty body
      // (no content type), Eden hands back `""`, and `""` is not nullish — the
      // exact case `payloadOrNull`/`isReadableWeather` exist for. `json(route,
      // null)` would send the literal `"null"` and take the OTHER branch.
      if (options.weather === null) return emptyBody(route);
      return json(route, fixture.WEATHER);
    }
    if (at("cost/series")) {
      return json(
        route,
        fixture.costSeries(query.from ?? "", query.to ?? "", query.bucket ?? "day"),
      );
    }
    if (at("cost")) {
      return json(
        route,
        fixture.costBreakdown(query.from ?? isoAgo(86_400_000), query.to ?? nowIso()),
      );
    }
    if (at("energy/series")) {
      return json(
        route,
        fixture.energySeries(query.from ?? "", query.to ?? "", query.bucket ?? "day"),
      );
    }

    // ── Statistics ──────────────────────────────────────────────────────────
    if (at("statistics/comparison")) {
      return json(
        route,
        fixture.comparison(query.from ?? "", query.to ?? "", query.mode ?? "previous"),
      );
    }
    if (at("statistics/heatmap")) return json(route, fixture.heatmap());
    if (at("statistics/records")) return json(route, fixture.records());
    if (at("statistics/prices")) {
      if (options.prices === null) return emptyBody(route);
      return json(route, fixture.spotStats(query.from ?? "", query.to ?? ""));
    }
    if (at("settings/statistics")) {
      if (method === "PUT") return json(route, saved(fixture.STATISTICS_PREFS, body()));
      return json(route, fixture.STATISTICS_PREFS);
    }

    // ── Battery ─────────────────────────────────────────────────────────────
    // Measured capacity and SOH. The statistics page asks for this once, and
    // a plant with too few deep discharges legitimately has nothing to report —
    // which is what this returns, so the tiles' absent case is the default and
    // no spec has to opt out of it.
    if (at("battery/health")) return json(route, fixture.BATTERY_HEALTH);

    // ── Prices ──────────────────────────────────────────────────────────────
    if (at("prices/providers")) return json(route, fixture.PRICE_PROVIDERS);
    if (at("prices")) {
      if (options.prices === null) return emptyBody(route);
      return json(route, fixture.spotPriceView());
    }
    if (at("settings/spot-prices")) {
      if (method === "PUT") return json(route, saved(fixture.SPOT_PRICE_CONFIG, body()));
      return json(route, fixture.SPOT_PRICE_CONFIG);
    }

    // ── Forecast ────────────────────────────────────────────────────────────
    if (at("forecast/providers")) return json(route, fixture.FORECAST_PROVIDERS);
    if (at("forecast/correction")) return json(route, fixture.forecastCorrection());

    // ── Admin config panels ─────────────────────────────────────────────────
    if (at("settings/plant")) {
      if (method === "PUT") return json(route, saved(fixture.PLANT, body()));
      return json(route, fixture.PLANT);
    }
    if (at("settings/access")) {
      if (method === "PUT") return json(route, saved(fixture.ACCESS, body()));
      return json(route, fixture.ACCESS);
    }
    if (at("settings/tariff")) {
      if (method === "PUT") return json(route, saved(fixture.TARIFF, body()));
      return json(route, fixture.TARIFF);
    }
    if (at("settings/inverter/test")) {
      return json(route, {
        ok: true,
        metricCount: MANIFEST.metrics.length,
        durationMs: 84,
        metrics: MANIFEST.metrics.slice(0, 5).map((metric) => ({
          key: metric.key,
          label: metric.label,
          unit: metric.unit,
          group: metric.group,
          value: valueFor(metric, 1),
        })),
      });
    }
    if (at("settings/inverter")) {
      if (method === "PUT") return json(route, saved(fixture.INVERTER_CONFIG, body()));
      return json(route, fixture.INVERTER_CONFIG);
    }
    if (at("settings/mqtt/test")) return json(route, { ok: true });
    if (at("settings/mqtt")) {
      // The server masks the password on the way out, both on read and on save.
      if (method === "PUT")
        return json(route, { ...fixture.MQTT_CONFIG, ...body(), password: undefined });
      return json(route, fixture.MQTT_CONFIG);
    }
    if (at("settings/evcc")) {
      if (method === "PUT") return json(route, saved(fixture.EVCC_CONFIG, body()));
      return json(route, fixture.EVCC_CONFIG);
    }
    if (at("settings/logging")) {
      if (method === "PUT") {
        const level = (body().level ?? null) as string | null;
        return json(route, { level, effective: level ?? "info", default: "info" });
      }
      return json(route, fixture.LOGGING);
    }
    if (at("settings/weather")) {
      if (method === "PUT") return json(route, saved(fixture.WEATHER_CONFIG, body()));
      return json(route, fixture.WEATHER_CONFIG);
    }
    if (at("settings/automations")) {
      if (method === "PUT") return json(route, saved(fixture.automations(), body()));
      return json(route, fixture.automations());
    }
    if (at("settings/profile-sources")) {
      if (method === "PUT") return json(route, { sources: body().sources });
      return json(route, fixture.PROFILE_SOURCES);
    }
    if (at("settings/active-profile")) {
      return json(route, { id: body().id, restartRequired: false });
    }

    // ── Profiles ────────────────────────────────────────────────────────────
    if (at("profiles/updates")) return json(route, fixture.profileUpdates());
    if (at("profiles/available")) return json(route, fixture.AVAILABLE_PROFILES);
    if (at("profiles/install")) return json(route, { id: body().id, version: "1.1.0" });
    if (at("profiles")) return json(route, fixture.profiles(MANIFEST));
    if (under("profiles") && method === "DELETE") return json(route, { ok: true, id });

    // ── Commands ────────────────────────────────────────────────────────────
    if (at("commands/setting")) {
      return json(route, { ok: true, key: body().key, value: body().value });
    }
    if (at("commands/evcc")) return json(route, { ok: true });

    // ── Admin ───────────────────────────────────────────────────────────────
    if (at("admin/api-keys/revoke")) return json(route, { success: true });
    if (at("admin/api-keys")) {
      if (method === "POST") {
        // The form reads only `data.key`; the real body is a Better Auth key.
        return json(route, { id: "key-2", name: body().name, key: "sr_live_e2e_generated_key" });
      }
      return json(route, fixture.apiKeys(SESSION_USER));
    }
    if (at("admin/reset-data")) {
      return json(route, { ok: true, cleared: ["metrics_raw", "hourly_rollups", "daily_rollups"] });
    }
    if (at("admin/restart")) return json(route, { ok: true });

    // Anything else is a contract this fixture has not been taught. Recorded
    // rather than silently 404'd into a blank page.
    unhandled.push(path);
    return json(route, {}, 404);
  });

  /**
   * One frame on `topic`, awaited past the render flush.
   *
   * Throws rather than no-oping when the topic was never subscribed: a spec
   * that pushes into the void and then waits for the DOM to change is a
   * fifteen-second timeout with no explanation, and the usual cause is the
   * admin gate above having refused the topic.
   */
  async function push(topic: string, data: unknown): Promise<void> {
    if (sockets.length === 0) throw new Error(`push("${topic}"): no live socket`);
    if (!subscribed.has(topic)) {
      const refused = denied.includes(topic) ? " — the ack DENIED it (admin-only topic?)" : "";
      throw new Error(`push("${topic}"): nothing is subscribed to it${refused}`);
    }
    sendFrame(topic, data);
    await page.waitForTimeout(0);
  }

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
    pushEvcc(state = fixture.EVCC_STATE) {
      return push("evcc", state);
    },
    pushAutomations(message = fixture.automationStream()) {
      return push("automations", message);
    },
    pushLogs(entries = fixture.logBatch()) {
      return push("logs", entries);
    },
    get deniedTopics() {
      return denied;
    },
    stopFeed,
  };
  return backend;
}

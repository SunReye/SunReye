/**
 * The PR #60 outage, as behaviour instead of as a string.
 *
 * `InverterStore#backfill` sizes its request from `newestHeldMs()`, which walks
 * the `SvelteMap` of live buffers. `MetricsFeed.lease()` calls `#backfill()`
 * synchronously, and `lease()` is called from the shell's `$effect` in
 * `routes/(app)/+layout.svelte` — so a TRACKED read there makes the shell effect
 * depend on the very map that `seedBackfill` and every live frame then WRITE.
 *
 * What shipped: the effect invalidated on its own write, its cleanup released
 * the socket and the metrics lease, it re-ran, re-leased, re-fetched, wrote
 * again. About twelve cycles a second — 125 `/api/profile` and 125
 * `/api/history/recent` per ten seconds, a WebSocket "closed before the
 * connection is established" 2708 times, `MetricsFeed`'s `#consuming` flag never
 * latching, and every reading on the dashboard rendering as an em dash while the
 * server was perfectly healthy.
 *
 * `lib/inverter/store-backfill-wiring.test.ts` pins the literal `untrack(...)`
 * token, because runes do not run under `bun test`. That test passes for any
 * OTHER reactive read that reintroduces the loop, and fails for a rename that
 * changes nothing. This file is the real coverage: it asserts the four symptoms
 * a user actually saw, and it does not care how the fix is spelled.
 *
 * Deliberately on `/#/` (the overview) rather than `/history`: the loop lives in
 * the app SHELL, so it is on every route, and the overview is the cheap page
 * where a request storm cannot be confused with chart work.
 */

import { expect, test } from "@playwright/test";
import { mockBackend } from "./support/api-mock";
import { POWER_FLOW_READOUTS, powerFlowReadouts } from "./support/open-page";
import { countRequests } from "./support/perf";

/** `{t:"sub"|"unsub", topics}` frames the client sent for a given topic. */
function topicFrames(frames: readonly unknown[], t: "sub" | "unsub"): number {
  return frames.filter(
    (f): f is { t: string; topics: string[] } =>
      typeof f === "object" &&
      f !== null &&
      (f as { t?: unknown }).t === t &&
      Array.isArray((f as { topics?: unknown }).topics) &&
      (f as { topics: unknown[] }).topics.includes("metrics"),
  ).length;
}

test("the shell boots once and stays booted", async ({ page }) => {
  const backend = await mockBackend(page);
  await page.goto("/#/");

  // Deliberately NOT `waitForLive()`. In the broken build the socket never
  // stays up long enough to subscribe, so waiting for it would fail this test
  // in setup and the number that names the fault — the request rate — would
  // never be measured. Wait for the boot fetch itself instead.
  await expect
    .poll(() => backend.requestCount("/api/history/recent"), { timeout: 20_000 })
    .toBeGreaterThan(0);

  // Let the app settle well past the point the loop would have been running:
  // the broken build managed ~12 boot cycles a SECOND, so three seconds of
  // quiet is three seconds the bug could not have survived.
  const bootCalls = await countRequests(page, /\/api\/(profile|history\/recent)\b/, () =>
    page.waitForTimeout(3000),
  );

  // The boot is a boot, not a poll. Reverting the `untrack` scores 388-464 in
  // this window (this machine loops faster than the tablet's measured ~12/s).
  expect(bootCalls).toBe(0);

  // And the whole-session totals, so a storm that happened BEFORE the window
  // opened cannot hide either. Regex form: "/api/profile" as a substring also
  // matches "/api/profile-status", which the first-run gate fetches.
  expect(backend.requestCount(/\/api\/profile$/)).toBe(1);
  expect(backend.requestCount("/api/history/recent")).toBeLessThanOrEqual(2);
});

test("the live socket is opened once and the metrics lease is never dropped", async ({ page }) => {
  const backend = await mockBackend(page);
  await page.goto("/#/");
  // Again no `waitForLive()`: the assertion below IS the thing that would make
  // it time out, and a setup failure is a worse error message than a number.
  await expect.poll(() => backend.socketOpens, { timeout: 20_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(3000);

  // The socket closed before it could finish opening, 2708 times, because the
  // effect cleanup tore the connection down between every re-run. Reverting the
  // `untrack` scores hundreds of opens here (237-1339 across runs).
  expect(backend.socketOpens).toBe(1);

  // The lease is the other half: one `sub`, and no `unsub` at all while the
  // workspace is on screen. A re-leasing shell emits a matched pair per cycle.
  expect(topicFrames(backend.clientFrames, "sub")).toBe(1);
  expect(topicFrames(backend.clientFrames, "unsub")).toBe(0);
});

test("live frames reach the screen instead of every reading showing an em dash", async ({
  page,
}) => {
  // The symptom users reported. `#consuming` only latches once a lease survives
  // long enough to consume a frame, so in the broken build no frame was ever
  // applied and the dashboard read "—" against a perfectly healthy server.
  const backend = await mockBackend(page, { feedIntervalMs: 0 });
  await page.goto("/#/");
  await backend.waitForLive();

  // Every power-flow node on the overview renders a literal `—` when its value
  // is `undefined` (`power-flow-node.svelte`) — the reported symptom verbatim.
  //
  // Scoped to the DIAGRAM, and an exact count rather than a floor. The bare
  // `span.font-semibold.tabular-nums` locator is worn by sixteen components,
  // and now that the weather, energy and EVCC payloads are all mocked it also
  // sweeps their readouts — none of which the metrics feed owns. A floor of
  // three was then met without a single node recovering, and `first()` pointed
  // at a node only because the overview happens to place the diagram first.
  const readouts = powerFlowReadouts(page);
  await expect(readouts.first()).toBeVisible();

  for (let i = 0; i < 5; i++) await backend.pushMetrics();

  // Not "the first one recovered": every node the shell feeds must have a
  // number in it. In the broken build not one frame was ever applied.
  await expect(readouts.first()).toHaveText(/\d/, { timeout: 5000 });
  await expect(readouts).toHaveCount(POWER_FLOW_READOUTS);
  for (const text of await readouts.allTextContents()) expect(text).toMatch(/\d/);
});

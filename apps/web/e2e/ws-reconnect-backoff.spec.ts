/**
 * The live socket coming back after the server drops it — and not before.
 *
 * Locking the engine's reads down (issue #174) made the socket droppable for a
 * new reason: `/ws` now runs `requireSession` at the upgrade, so a restart, a
 * revoked session or a proxy timeout closes a connection the dashboard was
 * happily using. What the client does next is the whole user-visible difference
 * between "the numbers came back a second later" and either of the two ways
 * this goes wrong:
 *
 *   * never reconnecting — every reading on the page freezes at its last value
 *     with nothing to say it is stale, which is the outage PR #60 produced;
 *   * reconnecting immediately, forever — a browser tab that reopens a refused
 *     socket in a tight loop, which is a denial of service aimed at your own
 *     server, and precisely what an auth failure would trigger on every tab at
 *     once after a restart.
 *
 * `ReconnectingSocket` answers both with exponential backoff off the EdenWS
 * `close` event, and `src/lib/ws/reconnecting-socket.test.ts` proves the timer
 * arithmetic against a fake clock. What a unit test cannot prove is that the
 * mechanism is WIRED: that the app's socket is that class, that the bus replays
 * its subscriptions onto the new connection, and that a real close event
 * reaches it. That only exists in a running document, so it is proven here.
 *
 * Counts, not milliseconds: this browser composites in software and the suite
 * runs sharded, so a timing floor would measure the runner. The one time value
 * asserted is that the FIRST reconnect does not happen within a window far
 * shorter than the 1000 ms base delay — an inequality a loaded machine can only
 * make more true.
 */

import { expect, test } from "@playwright/test";
import { mockBackend } from "./support/api-mock";

/** Comfortably inside the 1000 ms base backoff, comfortably outside a busy loop. */
const WELL_INSIDE_BACKOFF_MS = 400;

test("a dropped socket reconnects, after a pause, and resubscribes", async ({ page }) => {
  const backend = await mockBackend(page);
  await page.goto("/#/");
  await backend.waitForLive();
  expect(backend.socketOpens).toBe(1);

  backend.dropSocket();

  // Not instantly: a client that reopens the moment it is closed turns a server
  // restart into a request storm from every open tab.
  await page.waitForTimeout(WELL_INSIDE_BACKOFF_MS);
  expect(backend.socketOpens).toBe(1);

  // But it does come back, and it asks for `metrics` again on the new
  // connection — the server's topic list is per-socket, so a reconnect that
  // did not resubscribe would be a socket that never delivers another frame.
  await backend.waitForLive();
  expect(backend.socketOpens).toBe(2);
  await backend.pushMetrics();
});

test("a healthy connection resets the backoff, so the second outage is not slower", async ({
  page,
}) => {
  // The boundary that separates backoff from a permanent penalty. Without the
  // reset on `open`, every drop over the life of a tab compounds: the fourth
  // one waits eight seconds, the sixth the 15 s ceiling, and a dashboard left
  // open for a day recovers from a blip minutes later.
  const backend = await mockBackend(page);
  await page.goto("/#/");
  await backend.waitForLive();

  backend.dropSocket();
  await backend.waitForLive();
  expect(backend.socketOpens).toBe(2);

  backend.dropSocket();
  await page.waitForTimeout(WELL_INSIDE_BACKOFF_MS);
  expect(backend.socketOpens).toBe(2); // still backing off, not hammering

  // The second recovery must land inside the FIRST delay's budget. If the
  // attempt counter had carried over, this reconnect would be waiting 2000 ms
  // and this poll would time out.
  await expect.poll(() => backend.socketOpens, { timeout: 1800 }).toBe(3);
  await backend.waitForLive();
  await backend.pushMetrics();
});

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
 * The page's clock is paused and stepped by hand, so the delay is asserted
 * exactly: no reconnect one millisecond before the backoff, one at it. A
 * machine's load cannot move the timer.
 */

import { expect, test, type Page } from "@playwright/test";
import { mockBackend } from "./support/api-mock";

/** The first backoff step (`RECONNECT_BASE_MS` in `reconnecting-socket.ts`). */
const BASE_BACKOFF_MS = 1000;

/** Count the page's own `close` events on its sockets. After `mockBackend`: it replaces `WebSocket`. */
async function countSocketCloses(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const Native = window.WebSocket;
    const w = window as unknown as { __socketCloses: number };
    w.__socketCloses = 0;
    window.WebSocket = class extends Native {
      constructor(...args: ConstructorParameters<typeof Native>) {
        super(...args);
        this.addEventListener("close", () => void w.__socketCloses++);
      }
    };
  });
}

const closes = (page: Page) =>
  page.evaluate(() => (window as unknown as { __socketCloses: number }).__socketCloses);

/** Stop the page's clock where it stands; only `runFor` moves it from here. */
async function freeze(page: Page): Promise<void> {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(new Date(now + 1000));
}

/** Step the page's clock, then a round trip so a socket it opened has reached the mock. */
async function advance(page: Page, ms: number): Promise<void> {
  await page.clock.runFor(ms);
  await page.evaluate(() => 0);
}

/** Server drops the socket; resolves once the page has handled the close and armed its timer. */
async function dropAndAwaitClose(
  page: Page,
  backend: { dropSocket(): void },
  expected: number,
): Promise<void> {
  backend.dropSocket();
  await expect.poll(() => closes(page)).toBe(expected);
}

test("a dropped socket reconnects, after a pause, and resubscribes", async ({ page }) => {
  await page.clock.install();
  const backend = await mockBackend(page);
  await countSocketCloses(page);
  await page.goto("/#/");
  await backend.waitForLive();
  expect(backend.socketOpens).toBe(1);
  await freeze(page);

  await dropAndAwaitClose(page, backend, 1);

  // Not instantly: a client that reopens the moment it is closed turns a server
  // restart into a request storm from every open tab.
  await advance(page, BASE_BACKOFF_MS - 1);
  expect(backend.socketOpens).toBe(1);

  // But it does come back, and it asks for `metrics` again on the new
  // connection — the server's topic list is per-socket, so a reconnect that
  // did not resubscribe would be a socket that never delivers another frame.
  await advance(page, 1);
  await page.clock.resume();
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
  await page.clock.install();
  const backend = await mockBackend(page);
  await countSocketCloses(page);
  await page.goto("/#/");
  await backend.waitForLive();
  await freeze(page);

  await dropAndAwaitClose(page, backend, 1);
  await advance(page, BASE_BACKOFF_MS);
  await page.clock.resume();
  await backend.waitForLive();
  expect(backend.socketOpens).toBe(2);
  await freeze(page);

  await dropAndAwaitClose(page, backend, 2);
  await advance(page, BASE_BACKOFF_MS - 1);
  expect(backend.socketOpens).toBe(2); // still backing off, not hammering

  // The second recovery must land at the FIRST delay. If the attempt counter
  // had carried over, the timer would be at 2000 ms and this step would not
  // reach it.
  await advance(page, 1);
  await page.clock.resume();
  await backend.waitForLive();
  expect(backend.socketOpens).toBe(3);
  await backend.pushMetrics();
});

import { describe, expect, test } from "bun:test";
import type { StatisticsLiveMessage, StatisticsTodayMessage } from "@SunReye/contracts/statistics";
import { resolveCostPreset } from "$lib/cost/ranges";
import { StatisticsLiveFeed, type StatisticsFeedHooks } from "./live-feed";

const NOW = new Date("2026-08-02T10:30:00");
const MINUTE = 60_000;

const todayRange = () => resolveCostPreset("today", NOW);
const windowRange = () => resolveCostPreset("7d", NOW);

function todayMessage(at = "2026-08-02T10:30:00.000Z"): StatisticsTodayMessage {
  return {
    type: "today",
    at,
    cost: {} as StatisticsTodayMessage["cost"],
    energy: {} as StatisticsTodayMessage["energy"],
  };
}

/** A feed wired to a fake topic lease, so nothing here needs a socket. */
function harness(startAt = 1_000_000) {
  let clock = startAt;
  let handler: ((data: StatisticsLiveMessage) => void) | null = null;
  const seen = {
    subscribes: 0,
    disposes: 0,
    today: [] as (StatisticsTodayMessage | null)[],
    revisions: 0,
    priceRevisions: 0,
  };
  const hooks: StatisticsFeedHooks = {
    subscribe: (on) => {
      seen.subscribes += 1;
      handler = on;
      return () => {
        seen.disposes += 1;
        handler = null;
      };
    },
    onToday: (snapshot) => seen.today.push(snapshot),
    onRevision: () => (seen.revisions += 1),
    onPriceRevision: () => (seen.priceRevisions += 1),
    now: () => clock,
  };
  return {
    feed: new StatisticsLiveFeed(hooks),
    seen,
    push: (message: StatisticsLiveMessage) => handler?.(message),
    advance: (ms: number) => (clock += ms),
    get subscribed() {
      return handler !== null;
    },
  };
}

describe("StatisticsLiveFeed transport lease", () => {
  test("takes one topic lease for the first range and gives it back with the last", () => {
    const h = harness();
    const first = h.feed.lease(todayRange());
    const second = h.feed.lease(windowRange());
    expect(h.seen.subscribes).toBe(1);

    first();
    expect(h.subscribed).toBe(true);
    second();
    expect(h.seen.disposes).toBe(1);
    expect(h.subscribed).toBe(false);
  });

  test("a disposer run twice does not release someone else's lease", () => {
    const h = harness();
    const release = h.feed.lease(todayRange());
    release();
    release();
    h.feed.lease(todayRange());
    expect(h.seen.subscribes).toBe(2);
    expect(h.seen.disposes).toBe(1);
  });

  test("drops the snapshot when the last lease goes, so no frozen tiles remain", () => {
    const h = harness();
    const release = h.feed.lease(todayRange());
    h.push(todayMessage());
    release();
    expect(h.seen.today.at(-1)).toBeNull();
  });
});

describe("StatisticsLiveFeed frame application", () => {
  test("a today lease patches the snapshot and never revalidates", () => {
    const h = harness();
    h.feed.lease(todayRange());
    const message = todayMessage();
    h.push(message);
    expect(h.seen.today).toEqual([message]);
    expect(h.seen.revisions).toBe(0);
  });

  test("a window lease revalidates on the minute instead of patching", () => {
    const h = harness();
    h.feed.lease(windowRange());
    h.push(todayMessage());
    // The page has just fetched this window: the throttle starts closed.
    expect(h.seen.revisions).toBe(0);
    expect(h.seen.today).toEqual([]);

    h.advance(MINUTE);
    h.push(todayMessage());
    expect(h.seen.revisions).toBe(1);

    h.advance(MINUTE - 1);
    h.push(todayMessage());
    expect(h.seen.revisions).toBe(1);
  });

  test("a price sync invalidates price-derived reads under any mode", () => {
    const h = harness();
    h.feed.lease(windowRange());
    h.push({ type: "prices" });
    h.push({ type: "prices" });
    expect(h.seen.priceRevisions).toBe(2);
    expect(h.seen.revisions).toBe(0);
    expect(h.seen.today).toEqual([]);
  });

  test("ignores frames that arrive with no lease held", () => {
    const h = harness();
    const release = h.feed.lease(todayRange());
    release();
    h.push(todayMessage());
    expect(h.seen.today).toEqual([null]);
  });
});

describe("StatisticsLiveFeed with two leases of different ranges", () => {
  test("serves both modes at once instead of the newer range winning", () => {
    const h = harness();
    h.feed.lease(todayRange());
    h.feed.lease(windowRange());
    h.advance(MINUTE);

    const message = todayMessage();
    h.push(message);
    expect(h.seen.today).toEqual([message]);
    expect(h.seen.revisions).toBe(1);
  });

  test("releasing the wider lease leaves the today lease still patching", () => {
    const h = harness();
    h.feed.lease(todayRange());
    const wide = h.feed.lease(windowRange());
    wide();
    h.advance(MINUTE);

    const message = todayMessage();
    h.push(message);
    expect(h.seen.today).toEqual([message]);
    // The wider window is gone: nothing left to revalidate.
    expect(h.seen.revisions).toBe(0);
  });

  test("releasing the today lease stops the patching but keeps the window live", () => {
    const h = harness();
    const narrow = h.feed.lease(todayRange());
    h.feed.lease(windowRange());
    narrow();
    h.advance(MINUTE);

    h.push(todayMessage());
    expect(h.seen.today).toEqual([]);
    expect(h.seen.revisions).toBe(1);
  });
});

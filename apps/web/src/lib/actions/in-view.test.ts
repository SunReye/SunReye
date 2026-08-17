import { afterEach, describe, expect, test } from "bun:test";

import { RETENTION_BAND, inView } from "./in-view";

// bun test has no DOM: stub just enough IntersectionObserver to capture the
// callback and drive it with fake entries.
type IoCallback = (entries: { isIntersecting: boolean }[]) => void;
const created: {
  callback: IoCallback;
  options?: IntersectionObserverInit;
  disconnected: boolean;
  observed: unknown[];
}[] = [];

class FakeIntersectionObserver {
  callback: IoCallback;
  options?: IntersectionObserverInit;
  disconnected = false;
  observed: unknown[] = [];
  constructor(callback: IoCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
    created.push(this);
  }
  observe(node: unknown) {
    this.observed.push(node);
  }
  disconnect() {
    this.disconnected = true;
  }
}

const realIo = globalThis.IntersectionObserver;
globalThis.IntersectionObserver =
  FakeIntersectionObserver as unknown as typeof IntersectionObserver;
afterEach(() => {
  created.length = 0;
});
// Restore after the file's tests so other suites see the real global (if any).
process.on("beforeExit", () => {
  globalThis.IntersectionObserver = realIo;
});

const node = {} as HTMLElement;

describe("inView action", () => {
  test("observes the node and fires onEnter/onLeave per entry", () => {
    let enters = 0;
    let leaves = 0;
    inView(node, { onEnter: () => enters++, onLeave: () => leaves++ });

    const io = created[0]!;
    expect(io.observed).toEqual([node]);
    io.callback([{ isIntersecting: true }, { isIntersecting: false }]);
    expect(enters).toBe(1);
    expect(leaves).toBe(1);
  });

  test("defaults rootMargin to 200px and honors an override", () => {
    inView(node, undefined);
    inView(node, { rootMargin: "50px" });
    expect(created[0]!.options?.rootMargin).toBe("200px");
    expect(created[1]!.options?.rootMargin).toBe("50px");
  });

  test("update() swaps handlers; destroy() disconnects", () => {
    let first = 0;
    let second = 0;
    const handle = inView(node, { onEnter: () => first++ });
    const io = created[0]!;

    handle?.update?.({ onEnter: () => second++ });
    io.callback([{ isIntersecting: true }]);
    expect(first).toBe(0);
    expect(second).toBe(1);

    // undefined params (and missing handlers) must not throw.
    handle?.update?.(undefined);
    io.callback([{ isIntersecting: true }, { isIntersecting: false }]);

    handle?.destroy?.();
    expect(io.disconnected).toBe(true);
  });
});

/**
 * The retention band. Mounting and unmounting used to share one 200px margin,
 * so a half-screen nudge past a card's edge tore its chart down and the nudge
 * back rebuilt it — ~270ms of LayerChart construction for a gesture that never
 * left the card. The band splits the two: arm early, let go late.
 *
 * Bounded deliberately. A LayerChart instance measures ~1.7MB of heap, so a
 * ±1500px band retains 12-15 charts (~25MB) on the tablet that is the actual
 * complaint; retaining all 63 cards would be ~100MB.
 */
describe("retention band", () => {
  const px = (value: string) => Number.parseFloat(value);

  test("holds on to a card for at least a viewport past where it mounts it", () => {
    // The INEQUALITY, not the two numbers: a later edit that collapses the band
    // back to one symmetric margin brings the thrash back, and must go red here
    // even if it picks different values.
    expect(px(RETENTION_BAND.retain)).toBeGreaterThanOrEqual(px(RETENTION_BAND.mount) + 1000);
  });

  test("mounts early enough that the chart is built before the card is seen", () => {
    expect(px(RETENTION_BAND.mount)).toBeGreaterThan(0);
  });

  test("stays bounded — an unbounded band retains every chart on the page", () => {
    // ~1.7MB per instance: 1500px is ~15 charts, 10000px would be the whole grid.
    expect(px(RETENTION_BAND.retain)).toBeLessThanOrEqual(3000);
  });

  test("mounts on the mount margin and releases only on the retain margin", () => {
    let enters = 0;
    let leaves = 0;
    inView(node, {
      rootMargin: RETENTION_BAND.mount,
      retainMargin: RETENTION_BAND.retain,
      onEnter: () => enters++,
      onLeave: () => leaves++,
    });

    // Two observers, each with its own margin, each watching the node.
    const [mount, retain] = created;
    expect(mount!.options?.rootMargin).toBe(RETENTION_BAND.mount);
    expect(retain!.options?.rootMargin).toBe(RETENTION_BAND.retain);
    expect(mount!.observed).toEqual([node]);
    expect(retain!.observed).toEqual([node]);

    // Inside the narrow band: mount. Leaving it is NOT an unmount — the wide
    // observer still holds the card.
    mount!.callback([{ isIntersecting: true }]);
    expect(enters).toBe(1);
    mount!.callback([{ isIntersecting: false }]);
    expect(leaves).toBe(0);

    // Only leaving the wide band releases it. (And entering the wide band is
    // not a mount — that is the narrow observer's call.)
    retain!.callback([{ isIntersecting: true }]);
    expect(enters).toBe(1);
    retain!.callback([{ isIntersecting: false }]);
    expect(leaves).toBe(1);
  });

  test("update() swaps handlers on both observers; destroy() disconnects both", () => {
    let first = 0;
    let second = 0;
    const handle = inView(node, {
      rootMargin: RETENTION_BAND.mount,
      retainMargin: RETENTION_BAND.retain,
      onEnter: () => first++,
      onLeave: () => first++,
    });
    const [mount, retain] = created;

    handle?.update?.({
      rootMargin: RETENTION_BAND.mount,
      retainMargin: RETENTION_BAND.retain,
      onEnter: () => second++,
      onLeave: () => second++,
    });
    mount!.callback([{ isIntersecting: true }]);
    retain!.callback([{ isIntersecting: false }]);
    expect(first).toBe(0);
    expect(second).toBe(2);

    handle?.update?.(undefined);
    mount!.callback([{ isIntersecting: true }]);
    retain!.callback([{ isIntersecting: false }]);

    handle?.destroy?.();
    expect(mount!.disconnected).toBe(true);
    expect(retain!.disconnected).toBe(true);
  });

  test("without retainMargin the single-margin path is untouched — one observer, both edges", () => {
    let enters = 0;
    let leaves = 0;
    inView(node, { onEnter: () => enters++, onLeave: () => leaves++ });

    expect(created).toHaveLength(1);
    created[0]!.callback([{ isIntersecting: true }, { isIntersecting: false }]);
    expect(enters).toBe(1);
    expect(leaves).toBe(1);
  });
});

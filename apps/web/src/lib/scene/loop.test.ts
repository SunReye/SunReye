/// <reference types="bun" />
import { expect, test } from "bun:test";
import { frameInterval, Pace, type FrameLimit } from "@sunreye/builder/scene/frame-limit.ts";
import { Loop, type Frames } from "@sunreye/builder/scene/loop.ts";

/** A display at 60 Hz, each frame run by hand. */
function display() {
  let pending: ((now: number) => void) | undefined;
  let now = 0;

  const frames: Frames = {
    request(frame) {
      pending = frame;

      return 1;
    },
    cancel() {
      pending = undefined;
    },
  };

  return {
    frames,
    /** Whether a frame is asked for. */
    get asked() {
      return pending !== undefined;
    },
    /** Runs `count` frames, `ms` apart; false once none was asked for. */
    run(count: number, ms = 1000 / 60): boolean {
      for (let i = 0; i < count; i++) {
        const frame = pending;

        if (frame === undefined) return false;

        pending = undefined;
        now += ms;
        frame(now);
      }

      return true;
    },
  };
}

/** A loop on a 60 Hz display, held to `limit`. */
function open(limit: FrameLimit = "unlimited") {
  const screen = display();
  const seen = { draws: 0, counted: 0, started: 0, stopped: 0 };
  const pace = new Pace(() => frameInterval(limit));

  const loop = new Loop({
    frames: screen.frames,
    due: (now) => pace.take(now),
    draw() {
      seen.draws += 1;
    },
    count() {
      seen.counted += 1;
    },
    started() {
      seen.started += 1;
    },
    stopped() {
      seen.stopped += 1;
    },
  });

  return { screen, seen, loop };
}

test("nothing loops until something kept shows; then it draws in every frame the display gives", () => {
  const { screen, seen, loop } = open();

  expect([loop.running, screen.asked]).toEqual([false, false]);

  const times: number[] = [];

  loop.keep((seconds) => {
    times.push(seconds);
  });
  expect([loop.running, seen.started]).toEqual([true, 1]);
  screen.run(60);
  expect(seen.draws).toBe(60);
  // Each keeper steps before each draw, by the loop's own clock.
  expect(times.length).toBe(60);
  expect(times.at(-1)).toBeCloseTo(59 / 60, 2);
});

test("the frame limit holds the loop: under 30 it draws in every other frame of a 60 Hz display", () => {
  const { screen, seen, loop } = open("30");
  const times: number[] = [];

  loop.keep((seconds) => {
    times.push(seconds);
  });
  screen.run(60);
  expect(seen.draws).toBe(30);
  // What moves steps only for a frame that is drawn, and by the time that passed.
  expect(times.length).toBe(30);
  expect(times.at(-1)).toBeCloseTo(58 / 60, 2);
});

test("the loop runs while any keeper holds it and stops with the last", () => {
  const { screen, seen, loop } = open();
  const particles = loop.keep(() => {});
  const glass = loop.keep(() => {});

  screen.run(4);
  particles();
  // Released twice counts once.
  particles();
  expect(loop.running).toBe(true);
  expect(screen.run(4)).toBe(true);

  expect(seen.stopped).toBe(0);
  glass();
  expect([loop.running, screen.asked]).toEqual([false, false]);
  // Whoever draws on is told, once: the last frame is theirs to settle.
  expect(seen.stopped).toBe(1);

  const { draws } = seen;

  expect(screen.run(4)).toBe(false);
  expect(seen.draws).toBe(draws);
});

test("a paused loop asks for no frame, and its clock stands until it runs again", () => {
  const { screen, seen, loop } = open();
  const times: number[] = [];

  loop.keep((seconds) => {
    times.push(seconds);
  });
  screen.run(60);
  loop.pause("hidden", true);
  loop.pause("off screen", true);
  expect([loop.running, screen.asked]).toEqual([false, false]);

  // One reason gone, the other holds.
  loop.pause("hidden", false);
  expect([loop.running, screen.asked]).toEqual([false, false]);

  const { draws } = seen;
  const before = times.at(-1) ?? 0;

  loop.pause("off screen", false);
  expect(loop.running).toBe(true);
  // Ten minutes later.
  screen.run(1, 600_000);
  expect(seen.draws).toBe(draws + 1);
  expect((times.at(-1) ?? 0) - before).toBeLessThan(0.05);
});

test("a frame that stalls moves the clock a tenth of a second at most", () => {
  const { screen, loop } = open();
  const times: number[] = [];

  loop.keep((seconds) => {
    times.push(seconds);
  });
  screen.run(3);
  screen.run(1, 3000);
  expect((times.at(-1) ?? 0) - (times.at(-2) ?? 0)).toBeCloseTo(0.1, 2);
});

test("the frame watch is told of every frame the display gives, drawn in or not", () => {
  const { screen, seen, loop } = open("30");

  loop.keep(() => {});
  screen.run(60);
  expect([seen.counted, seen.draws]).toEqual([60, 30]);
});

test("a keeper that lets go in its own step ends the loop there, and the stop is told", () => {
  const { screen, seen, loop } = open();

  const release = loop.keep(() => {
    release();
  });

  screen.run(1);
  expect([loop.running, screen.asked, seen.stopped]).toEqual([false, false, 1]);
});

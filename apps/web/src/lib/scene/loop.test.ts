/// <reference types="bun" />
import { expect, test } from "bun:test";
import { Loop, type Frames } from "./loop.ts";

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

function open() {
  const screen = display();
  const seen = { draws: 0, counted: 0, stopped: 0 };

  const loop = new Loop({
    frames: screen.frames,
    draw() {
      seen.draws += 1;

      return false;
    },
    count() {
      seen.counted += 1;
    },
    stopped() {
      seen.stopped += 1;
    },
  });

  return { screen, seen, loop };
}

test("nothing loops until something kept shows; then it draws 30 times a second on a 60 Hz display", () => {
  const { screen, seen, loop } = open();

  expect([loop.running, screen.asked]).toEqual([false, false]);

  const times: number[] = [];

  loop.keep((seconds) => times.push(seconds));
  expect(loop.running).toBe(true);
  screen.run(60);
  expect(seen.draws).toBe(30);
  // Each keeper steps before each draw, by the loop's own clock.
  expect(times.length).toBe(30);
  expect(times.at(-1)).toBeCloseTo(29 / 30, 2);
});

test("the cap holds on a 120 Hz display and bears a frame that comes early", () => {
  const { screen, seen, loop } = open();

  loop.keep(() => {});
  screen.run(120, 1000 / 120);
  expect(seen.draws).toBe(30);

  seen.draws = 0;

  // 60 Hz with a jitter of 2 ms either way.
  for (let i = 0; i < 30; i++) {
    screen.run(1, 1000 / 60 - 2);
    screen.run(1, 1000 / 60 + 2);
  }

  expect(seen.draws).toBe(30);
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

  loop.keep((seconds) => times.push(seconds));
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

  loop.keep((seconds) => times.push(seconds));
  screen.run(3);
  screen.run(1, 3000);
  expect((times.at(-1) ?? 0) - (times.at(-2) ?? 0)).toBeCloseTo(0.1, 2);
});

test("the frame watch is told of every frame the display gives, drawn in or not", () => {
  const { screen, seen, loop } = open();

  loop.keep(() => {});
  screen.run(60);
  expect(seen.counted).toBe(60);
});

test("a picture that changed besides is drawn in the next frame, and on while the draw says so", () => {
  const screen = display();
  let flying = 0;
  let draws = 0;

  const loop = new Loop({
    frames: screen.frames,
    draw() {
      draws += 1;
      flying -= 1;

      return flying > 0;
    },
    count() {},
    stopped() {},
  });

  loop.keep(() => {});
  screen.run(1);
  expect(draws).toBe(1);

  loop.ask();
  screen.run(1);
  expect(draws).toBe(2);

  // A flight of five frames, each drawn.
  flying = 5;
  loop.ask();
  screen.run(5);
  expect(draws).toBe(7);
  // Then the cap again.
  screen.run(1);
  expect(draws).toBe(7);
});

test("a keeper that lets go in its own step ends the loop there, and the stop is told", () => {
  const { screen, seen, loop } = open();

  const release = loop.keep(() => {
    release();
  });

  screen.run(1);
  expect([loop.running, screen.asked, seen.stopped]).toEqual([false, false, 1]);
});

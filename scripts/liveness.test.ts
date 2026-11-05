import { expect, test } from "bun:test";

import { stallWatch, whileBusy } from "./liveness";

const answer = (status: number, headers: Record<string, string> = {}) =>
  new Response(status === 200 ? "ok" : "no", { status, headers });

/** A clock the test moves and a pause that moves it, so no real time passes. */
function clock() {
  const state = { at: 0, pauses: [] as number[] };
  return {
    state,
    now: () => state.at,
    pause: async (ms: number) => {
      state.pauses.push(ms);
      state.at += ms;
    },
  };
}

/** `request` answering each of `answers` in turn. */
const answering = (...answers: Response[]) => {
  let calls = 0;
  const request = async () => answers[calls++] as Response;
  return { request, calls: () => calls };
};

test("a 200 is returned at once, without a pause", async () => {
  const { state, ...time } = clock();
  const served = answering(answer(200));
  const response = await whileBusy("GET /x", served.request, { deadlineMs: 1000, ...time });
  expect(response.status).toBe(200);
  expect(served.calls()).toBe(1);
  expect(state.pauses).toEqual([]);
});

test("a 503 is asked again after its Retry-After, until the core answers", async () => {
  const { state, ...time } = clock();
  const served = answering(
    answer(503, { "retry-after": "2" }),
    answer(503, { "retry-after": "1" }),
    answer(200),
  );
  const response = await whileBusy("GET /x", served.request, { deadlineMs: 10_000, ...time });
  expect(response.status).toBe(200);
  expect(served.calls()).toBe(3);
  expect(state.pauses).toEqual([2000, 1000]);
});

test("a 503 without a usable Retry-After is asked again after a second", async () => {
  const { state, ...time } = clock();
  const served = answering(
    answer(503),
    answer(503, { "retry-after": "soon" }),
    answer(503, { "retry-after": "-3" }),
    answer(200),
  );
  await whileBusy("GET /x", served.request, { deadlineMs: 10_000, ...time });
  expect(state.pauses).toEqual([1000, 1000, 1000]);
});

test("a 503 that outlasts the deadline fails the run, naming the request and the wait", async () => {
  const { state, ...time } = clock();
  const served = answering(
    ...Array.from({ length: 10 }, () => answer(503, { "retry-after": "1" })),
  );
  await expect(whileBusy("GET /x", served.request, { deadlineMs: 3000, ...time })).rejects.toThrow(
    "GET /x still answers 503 after 3000 ms",
  );
  expect(state.pauses).toEqual([1000, 1000, 1000]);
  expect(served.calls()).toBe(4);
});

test("a deadline of zero lets a 503 fail without a pause", async () => {
  const { state, ...time } = clock();
  const served = answering(answer(503));
  await expect(whileBusy("GET /x", served.request, { deadlineMs: 0, ...time })).rejects.toThrow(
    "still answers 503",
  );
  expect(state.pauses).toEqual([]);
});

test("any other failure is returned at once for the caller to refuse", async () => {
  for (const status of [400, 401, 500, 502]) {
    const { state, ...time } = clock();
    const served = answering(answer(status), answer(200));
    const response = await whileBusy("GET /x", served.request, { deadlineMs: 10_000, ...time });
    expect(response.status).toBe(status);
    expect(served.calls()).toBe(1);
    expect(state.pauses).toEqual([]);
  }
});

/** Timers the test fires by hand. */
function timers() {
  const armed = new Map<number, () => void>();
  let next = 0;
  return {
    armed,
    set: (fire: () => void, ms: number) => {
      armed.set(++next, fire);
      return { id: next, ms };
    },
    clear: (handle: { id: number }) => void armed.delete(handle.id),
  };
}

test("a stall watch fires when no beat re-arms it, and a beat does not fire it", () => {
  const fake = timers();
  const stalls: string[] = [];
  const watch = stallWatch(500, () => stalls.push("stalled"), fake);
  expect(fake.armed.size).toBe(1);
  watch.beat();
  watch.beat();
  expect(fake.armed.size).toBe(1);
  expect(stalls).toEqual([]);
  [...fake.armed.values()][0]?.();
  expect(stalls).toEqual(["stalled"]);
});

test("a stopped stall watch never fires", () => {
  const fake = timers();
  const stalls: string[] = [];
  const watch = stallWatch(500, () => stalls.push("stalled"), fake);
  watch.stop();
  expect(fake.armed.size).toBe(0);
  watch.beat();
  watch.stop();
  expect(fake.armed.size).toBe(0);
});

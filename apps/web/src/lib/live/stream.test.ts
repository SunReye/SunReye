/// <reference types="bun" />
import { expect, test } from "bun:test";
import { age, streamState } from "./stream.ts";

test("before the first frame the stream is connecting", () => {
  expect(streamState()).toEqual({ kind: "connecting" });
});

test("fresh values are live", () => {
  expect(streamState({ devices: { "1": { "pv.power": 1, "load.power": 2 } } })).toEqual({
    kind: "live",
  });
});

test("a value still read keeps the stream live while others are stale", () => {
  expect(
    streamState({
      devices: { "1": { "pv.power": 1 }, "2": { "load.power": 2 } },
      stale: { "1": { "pv.power": 1000 } },
    }),
  ).toEqual({ kind: "live" });
});

test("when every value is stale the stream stalls, since its last reading", () => {
  expect(
    streamState({
      devices: { "1": { "pv.power": 1 }, "2": { "load.power": 2 } },
      stale: { "1": { "pv.power": 1000 }, "2": { "load.power": 3000 } },
    }),
  ).toEqual({ kind: "stalled", since: 3000 });
});

test("a broken stream is lost since it broke", () => {
  expect(streamState({ devices: { "1": { "pv.power": 1 } }, lost: 7000 })).toEqual({
    kind: "lost",
    since: 7000,
  });
});

test("a refused stream is lost with the core's reason", () => {
  expect(streamState({ problem: "auth.required" })).toEqual({
    kind: "lost",
    problem: "auth.required",
  });
});

test("an age reads in seconds up to a minute and a half, then in minutes", () => {
  expect(age(1000, 3400)).toBe("2 s");
  expect(age(0, 89_000)).toBe("89 s");
  expect(age(0, 150_000)).toBe("3 min");
  expect(age(5000, 4000)).toBe("0 s");
});

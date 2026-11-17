import { expect, test } from "vitest";
import type { Live } from "../api/core.ts";
import { feed } from "./stream.harness.ts";
import { stream } from "./stream.svelte.ts";

const FRAME: Live = { devices: { "1": { "pv.power": 1 } } };

test("followers share one subscription to the core, held until the last leaves", () => {
  let subscribed = 0;
  let stopped = 0;

  const core = {
    live: (listener: (live: Live) => void) => {
      subscribed++;
      listener(FRAME);

      return () => {
        stopped++;
      };
    },
  };

  const first = stream.follow(core);
  const second = stream.follow(core);

  expect(subscribed).toBe(1);

  second();
  second();
  expect(stopped).toBe(0);
  expect(stream.live).toEqual(FRAME);

  first();
  expect(stopped).toBe(1);
  expect(stream.live).toBeUndefined();
});

test("the last values outlast a refusal", () => {
  const send = feed();

  send(FRAME);
  send({ problem: "auth.required" });

  expect(stream.live).toEqual({ problem: "auth.required" });
  expect(stream.values).toEqual(FRAME);
});

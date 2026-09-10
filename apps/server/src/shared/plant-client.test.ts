import { describe, expect, test } from "bun:test";

import { plantClient } from "./plant-client";

/**
 * The one invariant this three-line module carries: it is built PER CALL.
 *
 * A module-level constant would capture the `db` binding at import time, and
 * `mock.module("@SunReye/db")` — which several suites use to point a route's
 * store at a double — would then never reach it. The failure is silent: the
 * test passes a fake client that nothing consults, and the code under test
 * talks to the real connection.
 */

describe("plantClient", () => {
  test("a fresh object each call, so a later module mock still reaches it", () => {
    const first = plantClient();
    const second = plantClient();
    expect(first).not.toBe(second);
    expect(first.execute).not.toBe(second.execute);
  });

  test("it satisfies the `execute`-only shape the repositories take", () => {
    const client = plantClient();
    expect(Object.keys(client)).toEqual(["execute"]);
    expect(client.execute).toBeInstanceOf(Function);
  });
});

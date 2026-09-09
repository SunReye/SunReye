import { describe, expect, mock, test } from "bun:test";
import { afterDeviceWrite } from "./after-device-write";

describe("afterDeviceWrite", () => {
  test("drops the cached plant facts BEFORE the runtime re-reads the roster", async () => {
    // Order matters: a reload that ran first would repopulate the cache from
    // the rows it reads, and the invalidation after it would throw that away
    // only to have the next reader refill it — harmless, but the reload itself
    // (and anything it triggers, like the forecast) would still have seen the
    // stale arrays.
    const calls: string[] = [];
    const facts = { invalidate: () => void calls.push("invalidate") };
    const reload = mock(async () => void calls.push("reload"));
    await afterDeviceWrite(facts, reload);
    expect(calls).toEqual(["invalidate", "reload"]);
  });

  test("a failing reload still leaves the cache dropped", async () => {
    const facts = { invalidate: mock(() => {}) };
    await expect(
      afterDeviceWrite(facts, async () => {
        throw new Error("endpoint unreachable");
      }),
    ).rejects.toThrow("endpoint unreachable");
    expect(facts.invalidate).toHaveBeenCalledTimes(1);
  });
});

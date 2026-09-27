import { describe, expect, test } from "bun:test";

import type { EvccIngest } from "./evcc";
import { evccControl, evccSnapshot, installEvccIngest } from "./evcc-instance";

describe("the installed EVCC ingest", () => {
  test("before boot installs one, every call answers like an ingest that is off", () => {
    // The automation IO can run before the composition root has built the
    // ingest; it may not crash on it, and a relayed command must fail with the
    // same reason a disconnected ingest gives.
    expect(evccSnapshot()).toBeNull();
    expect(() => evccControl(1, "mode", "pv")).toThrow("EVCC MQTT is not connected");
  });

  test("once installed, each call reaches that ingest", () => {
    const calls: unknown[] = [];
    const state = { reachable: true, loadpoints: [], subtractFromHome: false };
    const ingest: EvccIngest = {
      snapshot: () => state,
      control: (...args) => void calls.push(["control", ...args]),
      onLoadSample: () => {},
      rebuild: async () => {},
      stop: async () => {},
    };
    installEvccIngest(ingest);
    expect(evccSnapshot()).toBe(state);
    evccControl(2, "limitSoc", "80");
    expect(calls).toEqual([["control", 2, "limitSoc", "80"]]);
  });
});

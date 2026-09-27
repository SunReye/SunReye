import { describe, expect, test } from "bun:test";

import type { EvccIngest } from "./evcc";
import { evccControl, evccOnLoadSample, evccSnapshot, installEvccIngest } from "./evcc-instance";

describe("the installed EVCC ingest", () => {
  test("before boot installs one, every call answers like an ingest that is off", () => {
    // The poll loop and the automation IO can run before the composition root
    // has built the ingest; neither may crash on it, and a relayed command must
    // fail with the same reason a disconnected ingest gives.
    expect(evccSnapshot()).toBeNull();
    expect(() => evccOnLoadSample(1200)).not.toThrow();
    expect(() => evccControl(1, "mode", "pv")).toThrow("EVCC MQTT is not connected");
  });

  test("once installed, each call reaches that ingest", () => {
    const calls: unknown[] = [];
    const state = { reachable: true, loadpoints: [], subtractFromHome: false };
    const ingest: EvccIngest = {
      snapshot: () => state,
      control: (...args) => void calls.push(["control", ...args]),
      onLoadSample: (w) => void calls.push(["load", w]),
      rebuild: async () => {},
      stop: async () => {},
    };
    installEvccIngest(ingest);
    expect(evccSnapshot()).toBe(state);
    evccControl(2, "limitSoc", "80");
    evccOnLoadSample(null);
    expect(calls).toEqual([
      ["control", 2, "limitSoc", "80"],
      ["load", null],
    ]);
  });
});

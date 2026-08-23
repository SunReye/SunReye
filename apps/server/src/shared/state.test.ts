/**
 * The shared poll cache: the one sample the God-loop hands the HTTP/WS layer so
 * "current value" endpoints answer from memory.
 *
 * The import below carries a `?live` query on purpose. Two suites that run
 * before this one (`energy/cost.test.ts`, `forecast/solar-forecast.test.ts`)
 * replace `liveState` with a stand-in via `mock.module`, which is process-global
 * and permanent — a plain import here would hand this file one of *their*
 * doubles and test nothing. The query makes it a distinct specifier the mock
 * registry does not answer, so the module under test is the real one; it is a
 * fresh instance of it, which is exactly what a cache's own tests want anyway.
 */

import type { InverterSample } from "@SunReye/inverter-core";
import { describe, expect, test } from "bun:test";

// Held in a variable so the specifier stays a runtime one: the `?live` suffix is
// a resolver instruction, not a file TypeScript could look up.
const UNMOCKED = "./state.ts?live";
const { liveState } = (await import(UNMOCKED)) as typeof import("./state");

/** A sample as the poll loop builds it. */
const sample = (metrics: Record<string, number>, at = new Date()): InverterSample => ({
  time: at.toISOString(),
  inverterId: "inv-1",
  metrics,
});

// The cache has no reset hook — the poll loop only ever moves forward — so each
// test below stores the sample it depends on rather than assuming an empty one.
describe("the live poll cache", () => {
  test("answers null until the first successful poll", () => {
    // Only true before anything is stored, so it has to be asserted first: a
    // fresh process has no reading to report, and the endpoints must say so
    // rather than serve a zeroed sample that reads as "everything is off".
    expect(liveState.latest).toBeNull();
  });

  test("hands back the very sample it was given, not a copy", () => {
    // The automation IO layer compares by identity, and the metrics map is read
    // by key on every request — cloning would be both a lie and a cost.
    const s = sample({ "battery.soc": 42 });
    liveState.set(s);
    expect(liveState.latest).toBe(s);
  });

  test("a later poll replaces the earlier one", () => {
    liveState.set(sample({ "battery.soc": 42 }));
    const fresh = sample({ "battery.soc": 41 });
    liveState.set(fresh);
    expect(liveState.latest).toBe(fresh);
  });

  test("reads are live: a holder of the cache sees polls that land after it", () => {
    // The property is a getter, not a captured value. A consumer that grabs
    // `liveState` at wiring time (runtime.ts, entities.ts, the cost engine) must
    // still see the sample that arrives a second later.
    const read = () => liveState.latest;
    liveState.set(sample({ "battery.soc": 42 }));
    const first = read();
    liveState.set(sample({ "battery.soc": 43 }));
    expect(read()).not.toBe(first);
    expect(read()?.metrics["battery.soc"]).toBe(43);
  });

  test("an all-zero sample is a reading, not an absent one", () => {
    // 0 W and 0 % are values an inverter genuinely reports at night; storing one
    // must not read back as "no poll yet".
    const dark = sample({ "production.power": 0, "battery.soc": 0 });
    liveState.set(dark);
    expect(liveState.latest).toBe(dark);
    expect(liveState.latest?.metrics["production.power"]).toBe(0);
  });

  test("a sample carrying no metrics at all is still the latest sample", () => {
    // A profile can map nothing the poll succeeded on; the timestamp alone is
    // still the freshest thing known, and dropping it would strand the cache on
    // a stale reading.
    const empty = sample({});
    liveState.set(empty);
    expect(liveState.latest).toBe(empty);
    expect(liveState.latest?.metrics).toEqual({});
  });

  test("storing the same sample twice keeps it (the setter is idempotent)", () => {
    const s = sample({ "battery.soc": 42 });
    liveState.set(s);
    liveState.set(s);
    expect(liveState.latest).toBe(s);
  });

  test("a second device does not overwrite the first — the cache is keyed", () => {
    // It used to hold exactly one sample, because there was exactly one poll
    // loop. Two loops storing into one slot is the failure mode that looks
    // healthy: every reader would see whichever device ticked most recently,
    // at that device's timestamp, and call it current.
    const first = sample({ "battery.soc": 42 });
    const other: InverterSample = { ...sample({ "battery.soc": 7 }), inverterId: "inv-2" };

    liveState.set(first);
    liveState.set(other);

    expect(liveState.for("inv-1")).toBe(first);
    expect(liveState.for("inv-2")).toBe(other);
  });

  test("asking for a device that has never reported answers null", () => {
    expect(liveState.for("never-polled")).toBeNull();
  });

  test("`latest` answers the default device once one is named", () => {
    const mine = sample({ "battery.soc": 42 });
    const other: InverterSample = { ...sample({ "battery.soc": 7 }), inverterId: "inv-2" };
    liveState.set(mine);
    liveState.set(other);

    liveState.setDefaultDevice("inv-2");
    expect(liveState.latest).toBe(other);

    liveState.setDefaultDevice("inv-1");
    expect(liveState.latest).toBe(mine);
  });

  test("with no default named and two devices reporting, `latest` is null, not a guess", () => {
    // The dangerous answer here is a plausible one. Every caller of `latest`
    // was written when it could only mean one machine; handing it whichever
    // device ticked last would be silently wrong in a way nothing surfaces.
    liveState.setDefaultDevice(null);
    liveState.set(sample({ "battery.soc": 42 }));
    liveState.set({ ...sample({ "battery.soc": 7 }), inverterId: "inv-2" });

    expect(liveState.latest).toBeNull();
  });

  test("with no default named and one device reporting, `latest` is that device", () => {
    // Every install today. The single-device answer must not need configuring.
    liveState.reset();
    liveState.setDefaultDevice(null);
    const only = sample({ "battery.soc": 42 });
    liveState.set(only);

    expect(liveState.latest).toBe(only);
  });

  test("a named default that has not reported yet answers null, not another device", () => {
    liveState.reset();
    liveState.setDefaultDevice("inv-9");
    liveState.set(sample({ "battery.soc": 42 }));

    expect(liveState.latest).toBeNull();
  });
});

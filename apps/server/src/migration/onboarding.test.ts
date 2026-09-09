import { describe, expect, test } from "bun:test";

import { migrationRecordSchema } from "@SunReye/db/upgrade-state";

import {
  NAME_MAX,
  defaultDeviceName,
  migrationGateReason,
  migrationStatus,
  validateNames,
} from "./onboarding";

const CUTOVER = "2026-08-27T09:00:00.000Z";
const record = (partial: Record<string, unknown> = {}) => migrationRecordSchema.parse(partial);

describe("validateNames", () => {
  test("two names come back trimmed", () => {
    const result = validateNames({ plantName: "  Haus Süd  ", deviceName: " Deye SG05LP3 " });
    expect(result).toEqual({ ok: true, plantName: "Haus Süd", deviceName: "Deye SG05LP3" });
  });

  test("an empty plant name is REFUSED, because it is the MQTT namespace", () => {
    // It cannot be skipped: it becomes the topic namespace, it is frozen once
    // discovery has announced, and discovery is held until it exists.
    const result = validateNames({ plantName: "   ", deviceName: "Inverter" });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.plantName).toBeTruthy();
  });

  test("an empty device name is refused too — the field nobody remembers", () => {
    // The migration synthesises ONE device from the single `inverter` setting and
    // its slug sits in every topic. Capturing the name here is what stops an
    // auto-generated label becoming permanent.
    const result = validateNames({ plantName: "Haus", deviceName: "" });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.deviceName).toBeTruthy();
  });

  test("a plant name with nothing sluggable is refused", () => {
    // "!!!" trims to something non-empty and slugifies to "", which would render
    // `<prefix>//<topic>` — not a topic.
    const result = validateNames({ plantName: "!!!", deviceName: "Inverter" });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.plantName).toMatch(/letter|number/i);
  });

  test("diacritics are sluggable, so a German name is accepted", () => {
    expect(validateNames({ plantName: "Süd", deviceName: "Wechselrichter" }).ok).toBe(true);
  });

  test("a name longer than the limit is refused rather than silently cut", () => {
    // Silently truncating produces a slug the operator never chose, in every
    // topic, forever.
    const result = validateNames({ plantName: "x".repeat(NAME_MAX + 1), deviceName: "I" });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.plantName).toContain(String(NAME_MAX));
  });

  test("a name exactly at the limit is accepted", () => {
    expect(validateNames({ plantName: "x".repeat(NAME_MAX), deviceName: "I" }).ok).toBe(true);
  });

  test("both errors are reported at once, not one per round trip", () => {
    const result = validateNames({ plantName: "", deviceName: "" });
    expect(result.ok === false && Object.keys(result.errors).sort()).toEqual([
      "deviceName",
      "plantName",
    ]);
  });
});

describe("defaultDeviceName", () => {
  test("the profile's human name is the default", () => {
    expect(defaultDeviceName({ id: "deye-sg05lp3", name: "Deye SG05LP3" })).toBe("Deye SG05LP3");
  });

  test("the id is the fallback — never blank, so the field is pre-filled", () => {
    // A blank field is the one an operator submits without reading.
    expect(defaultDeviceName({ id: "deye-sg05lp3" })).toBe("deye-sg05lp3");
  });

  test("a whitespace-only profile name falls back to the id", () => {
    expect(defaultDeviceName({ id: "x", name: "   " })).toBe("x");
  });
});

describe("migrationStatus", () => {
  const names = { plantName: "Haus", deviceName: "Deye" };

  test("an install that never migrated needs nothing and says nothing", () => {
    const status = migrationStatus(record(), names);
    expect(status.onboardingRequired).toBe(false);
    expect(status.backfillOutstanding).toBe(false);
    expect(status.banner).toBeNull();
  });

  test("straight after the cutover: onboarding required, and the banner NAMES the date", () => {
    const status = migrationStatus(record({ stage: "cutover", cutoverAt: CUTOVER }), names);
    expect(status.onboardingRequired).toBe(true);
    expect(status.backfillOutstanding).toBe(true);
    expect(status.banner).toContain("2026-08-27");
    expect(status.historyFrom).toBe(CUTOVER);
  });

  test("once the raw window is carried, the banner moves back to where raw began", () => {
    const status = migrationStatus(
      record({
        stage: "carried",
        cutoverAt: CUTOVER,
        legacyRawFrom: "2026-08-20T00:00:00.000Z",
        namesConfirmedAt: CUTOVER,
      }),
      names,
    );
    expect(status.onboardingRequired).toBe(false);
    expect(status.historyFrom).toBe("2026-08-20T00:00:00.000Z");
    expect(status.banner).toContain("2026-08-20");
  });

  test("a DEFERRED migration keeps its banner — deferring is not finishing", () => {
    const status = migrationStatus(
      record({ stage: "deferred", cutoverAt: CUTOVER, namesConfirmedAt: CUTOVER }),
      names,
    );
    expect(status.backfillOutstanding).toBe(true);
    expect(status.banner).not.toBeNull();
  });

  test("a finished backfill has no banner and nothing outstanding", () => {
    const status = migrationStatus(
      record({ stage: "backfilled", cutoverAt: CUTOVER, namesConfirmedAt: CUTOVER }),
      names,
    );
    expect(status.backfillOutstanding).toBe(false);
    expect(status.banner).toBeNull();
    expect(status.historyFrom).toBeNull();
  });

  test("the current names travel with the status, so the form is pre-filled", () => {
    const status = migrationStatus(record({ stage: "cutover", cutoverAt: CUTOVER }), names);
    expect(status.plantName).toBe("Haus");
    expect(status.deviceName).toBe("Deye");
  });
});

describe("migrationGateReason", () => {
  test("an install that never migrated is NOT gated", () => {
    // The load-bearing default. A gate that engaged here would hold discovery on
    // every healthy install, which looks exactly like a broken MQTT bridge.
    expect(migrationGateReason(record())).toBeNull();
  });

  test("a cutover with unconfirmed names is gated, with a reason worth logging", () => {
    const reason = migrationGateReason(record({ stage: "cutover", cutoverAt: CUTOVER }));
    expect(reason).toBeTruthy();
    expect(reason).toMatch(/name/i);
  });

  test("a DEFERRED migration whose names are confirmed is not gated", () => {
    // Deferring the history backfill says nothing about the identity. The names
    // are what discovery waits for, and they exist.
    expect(
      migrationGateReason(
        record({ stage: "deferred", cutoverAt: CUTOVER, namesConfirmedAt: CUTOVER }),
      ),
    ).toBeNull();
  });

  test("a finished migration is not gated even if the confirmation field was lost", () => {
    // `dropped` is over. Re-gating on a missing bookkeeping field would hold
    // discovery forever on an install with nothing left to migrate.
    expect(migrationGateReason(record({ stage: "dropped" }))).toBeNull();
  });
});

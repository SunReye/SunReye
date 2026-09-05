import { describe, expect, test } from "bun:test";

import { migrationRecordSchema } from "@SunReye/db/upgrade-state";

import { SLUG_MAX } from "../inverter/provision";
import {
  type GateState,
  type OnboardingInput,
  backfillTarget,
  bannerSuppressed,
  migratedDevice,
  planOnboarding,
  slugFrozen,
} from "./onboarding-plan";

const CUTOVER = "2026-08-27T09:00:00.000Z";
const record = (partial: Record<string, unknown> = {}) => migrationRecordSchema.parse(partial);

/** Mid-migration, names not yet confirmed, discovery still held: the form is open. */
const OPEN: GateState = {
  record: record({ stage: "cutover", cutoverAt: CUTOVER }),
  discoveryHeld: "the names have not been confirmed yet",
};

const names: OnboardingInput = {
  plantName: "Haus Süd",
  deviceName: "Deye SG05LP3",
  migrateHistory: "later",
};

describe("slugFrozen", () => {
  test("a slug may still be corrected while onboarding is open and discovery is held", () => {
    expect(slugFrozen(OPEN)).toBe(false);
  });

  test("it is frozen the moment discovery has been ANNOUNCED", () => {
    // The whole point of the one-time edit window. The announcement is retained on
    // the broker and Home Assistant keys its entities on the unique_id built from
    // these slugs, so after it there is no edit that is not an orphaning.
    expect(slugFrozen({ ...OPEN, discoveryHeld: null })).toBe(true);
  });

  test("it is frozen once the names are confirmed, even if the gate is somehow still held", () => {
    // Confirming the names is what RELEASES the gate, so these two conditions
    // normally move together — but the record is the durable half and it wins. A
    // second POST arriving while the release is in flight must not slip a slug
    // change in behind the first one.
    expect(
      slugFrozen({
        record: record({ stage: "cutover", cutoverAt: CUTOVER, namesConfirmedAt: CUTOVER }),
        discoveryHeld: "stale",
      }),
    ).toBe(true);
  });

  test("and it is frozen on an install that never migrated at all", () => {
    expect(slugFrozen({ record: record(), discoveryHeld: null })).toBe(true);
  });
});

describe("planOnboarding", () => {
  test("both names, trimmed, with the frozen slugs left alone", () => {
    const plan = planOnboarding(OPEN, names);
    expect(plan).toEqual({
      ok: true,
      plantName: "Haus Süd",
      deviceName: "Deye SG05LP3",
      plantSlug: null,
      deviceSlug: null,
      migrateNow: false,
    });
  });

  test("'now' is carried through as the migrateNow decision", () => {
    const plan = planOnboarding(OPEN, { ...names, migrateHistory: "now" });
    expect(plan).toMatchObject({ ok: true, migrateNow: true });
  });

  test("a corrected slug is accepted while the window is open", () => {
    const plan = planOnboarding(OPEN, { ...names, plantSlug: "haus-sud", deviceSlug: "deye" });
    expect(plan).toMatchObject({ ok: true, plantSlug: "haus-sud", deviceSlug: "deye" });
  });

  // THE test this task exists for.
  test("a slug correction is REFUSED once discovery has been announced", () => {
    const plan = planOnboarding({ ...OPEN, discoveryHeld: null }, { ...names, plantSlug: "other" });
    expect(plan).toMatchObject({ ok: false, status: 409, error: "slug_frozen" });
  });

  test("the same refusal for a device slug, and it names the field", () => {
    const plan = planOnboarding(
      { ...OPEN, discoveryHeld: null },
      { ...names, deviceSlug: "other" },
    );
    expect(plan).toMatchObject({ ok: false, status: 409, error: "slug_frozen" });
    expect(plan.ok === false && "message" in plan && plan.message).toContain("deviceSlug");
  });

  test("but the NAMES are still accepted after the announcement — a name is not an identifier", () => {
    // The asymmetry is the point. Announcing under a placeholder happens when the
    // boot-time gate could not read the record; the operator must still be able to
    // finish onboarding (and stop being asked), and `name` is editable for the rest
    // of the install's life anyway.
    expect(planOnboarding({ ...OPEN, discoveryHeld: null }, names)).toMatchObject({ ok: true });
  });

  test("a slug equal to the one already frozen is not a change, so it is not refused", () => {
    // The form round-trips what it was shown. Refusing an unchanged value would
    // make the second submit of an unedited form fail for no reason.
    const plan = planOnboarding(
      { ...OPEN, discoveryHeld: null },
      { ...names, plantSlug: "haus" },
      {
        plantSlug: "haus",
        deviceSlug: "inverter",
      },
    );
    expect(plan).toMatchObject({ ok: true, plantSlug: null });
  });

  test("onboarding itself is closed once the names are confirmed", () => {
    const plan = planOnboarding(
      {
        record: record({ stage: "carried", cutoverAt: CUTOVER, namesConfirmedAt: CUTOVER }),
        discoveryHeld: null,
      },
      names,
    );
    expect(plan).toMatchObject({ ok: false, status: 409, error: "onboarding_closed" });
  });

  test("and on an install that never ran a 1.x upgrade there is nothing to confirm", () => {
    const plan = planOnboarding({ record: record(), discoveryHeld: null }, names);
    expect(plan).toMatchObject({ ok: false, status: 409, error: "onboarding_closed" });
  });

  test("both empty names are reported together, as a 400", () => {
    const plan = planOnboarding(OPEN, { plantName: "", deviceName: "  ", migrateHistory: "later" });
    expect(plan).toMatchObject({ ok: false, status: 400 });
    expect(plan.ok === false && "errors" in plan && plan.errors).toEqual({
      plantName: expect.stringContaining("required"),
      deviceName: expect.stringContaining("required"),
    });
  });

  test("a name that slugifies to nothing is refused before it can become a topic", () => {
    const plan = planOnboarding(OPEN, { ...names, plantName: "!!!" });
    expect(plan).toMatchObject({ ok: false, status: 400 });
  });

  test("a submitted slug must already be canonical — nothing may be silently rewritten", () => {
    // The refusal, not a quiet `slugify()` of the submission. A slug the operator
    // did not type is exactly the permanent surprise this whole window prevents.
    const plan = planOnboarding(OPEN, { ...names, plantSlug: "Haus Süd" });
    expect(plan).toMatchObject({ ok: false, status: 400 });
    expect(plan.ok === false && "errors" in plan && plan.errors.plantSlug).toContain("haus-sud");
  });

  test("an empty submitted slug is refused rather than treated as 'leave it alone'", () => {
    // `<prefix>//<topic>` is not a topic, and a blank field on a form that shows a
    // live preview means the operator cleared it, not that they meant the default.
    const plan = planOnboarding(OPEN, { ...names, deviceSlug: "" });
    expect(plan).toMatchObject({ ok: false, status: 400 });
  });

  test("an over-long slug is refused with the limit in the message", () => {
    const plan = planOnboarding(OPEN, { ...names, plantSlug: "a".repeat(SLUG_MAX + 1) });
    expect(plan.ok === false && "errors" in plan && plan.errors.plantSlug).toContain(
      String(SLUG_MAX),
    );
  });

  test("a slug problem and a name problem are reported in the SAME response", () => {
    const plan = planOnboarding(OPEN, { ...names, plantName: "", plantSlug: "Not A Slug" });
    expect(plan.ok === false && "errors" in plan && Object.keys(plan.errors).sort()).toEqual([
      "plantName",
      "plantSlug",
    ]);
  });
});

describe("bannerSuppressed", () => {
  const now = new Date("2026-09-01T12:00:00.000Z");

  test("nothing dismissed: the banner shows", () => {
    expect(bannerSuppressed(null, now)).toBe(false);
  });

  test("a live snooze hides it", () => {
    expect(bannerSuppressed("2026-09-08T12:00:00.000Z", now)).toBe(true);
  });

  test("an EXPIRED snooze shows it again — this is what makes a deferral get run", () => {
    expect(bannerSuppressed("2026-08-31T12:00:00.000Z", now)).toBe(false);
  });

  test("the boundary instant is over: a snooze until now has run out", () => {
    expect(bannerSuppressed(now.toISOString(), now)).toBe(false);
  });

  test("an unparseable snooze shows the banner rather than hiding data loss", () => {
    expect(bannerSuppressed("whenever", now)).toBe(false);
  });
});

describe("migratedDevice", () => {
  const device = (id: number, slug: string, profileId: string, role = "inverter") => ({
    id,
    slug,
    name: slug,
    profileId,
    role,
    unitId: 1,
    connectionId: null,
  });

  test("the device the legacy readings were re-keyed to, found by the 1.2.0 profile id", () => {
    const rows = [
      device(2, "controller", "victron-gx", "controller"),
      device(3, "inverter", "deye"),
    ];
    expect(migratedDevice(rows, "deye")?.id).toBe(3);
  });

  test("falls back to the plant's inverter when no row carries the source id", () => {
    // A profile swap between the cutover and onboarding leaves no profile_id
    // match, and the readings are still on that device.
    const rows = [device(2, "gx", "victron-gx", "controller"), device(4, "inverter", "sigenergy")];
    expect(migratedDevice(rows, "deye")?.id).toBe(4);
  });

  test("never a controller — its readings would start claiming to be an inverter's", () => {
    expect(migratedDevice([device(2, "gx", "victron-gx", "controller")], "deye")).toBeNull();
  });

  test("never an OPTIMIZER, even when it carries the 1.2.0 source id", () => {
    // A virtual device has no registers, so five million replayed inverter
    // readings keyed to it would be measurements attributed to a thing that
    // never measured anything. Arm 1 matches on profile id, so the role filter
    // is what stops it — not the absence of a match.
    const rows = [device(2, "optimizer", "deye", "optimizer")];
    expect(migratedDevice(rows, "deye")).toBeNull();
  });

  test("an optimizer alongside the inverter does not shadow it", () => {
    const rows = [device(2, "optimizer", "deye", "optimizer"), device(3, "inverter", "deye")];
    expect(migratedDevice(rows, "deye")?.id).toBe(3);
  });

  test("no devices at all is null rather than a guess", () => {
    expect(migratedDevice([], "deye")).toBeNull();
  });

  test("a lost source id still finds the inverter — it is the only row it could be", () => {
    // `sourceId` is nullable on the record and a corrupted write could blank it.
    // Refusing here would strand a migration that is otherwise fine.
    expect(migratedDevice([device(3, "inverter", "deye")], null)?.id).toBe(3);
  });
});

describe("backfillTarget", () => {
  const device = (id: number, profileId: string, role = "inverter") => ({
    id,
    slug: `d${id}`,
    name: `d${id}`,
    profileId,
    role,
    unitId: 1,
    connectionId: null,
  });
  const mid = record({ stage: "deferred", cutoverAt: CUTOVER, sourceId: "deye" });

  test("the device carrying the 1.2.0 profile id is the one the rows belong to", () => {
    expect(backfillTarget(mid, { id: 1 }, [device(7, "deye")])).toEqual({ ok: true, deviceId: 7 });
  });

  test("no plant is refused rather than guessed at", () => {
    expect(backfillTarget(mid, null, [device(7, "deye")])).toEqual({
      ok: false,
      reason: "no-plant",
    });
  });

  test("a plant whose only device is a CONTROLLER is refused", () => {
    // Attributing an inverter's five years of history to a plant controller is the
    // class of silent mislabelling 2.0.0 broke its schema to end. Writing nowhere
    // is recoverable; writing to the wrong device is not.
    expect(backfillTarget(mid, { id: 1 }, [device(7, "victron-gx", "controller")])).toEqual({
      ok: false,
      reason: "no-device",
    });
  });

  test("a plant whose only device is an OPTIMIZER is refused too", () => {
    // Same rule as the controller, for the stronger reason: the optimizer is
    // virtual, so the backfill would attribute a real machine's five years of
    // measurements to a device that has never read a register.
    expect(backfillTarget(mid, { id: 1 }, [device(7, "deye", "optimizer")])).toEqual({
      ok: false,
      reason: "no-device",
    });
  });

  test("no devices at all is the same refusal", () => {
    expect(backfillTarget(mid, { id: 1 }, [])).toEqual({ ok: false, reason: "no-device" });
  });

  test("a profile SWAP since the cutover still finds the inverter", () => {
    // Neither the slug nor the profile id matches after a swap, and the readings
    // are still on that device — the arm that makes the swap survivable.
    expect(backfillTarget(mid, { id: 1 }, [device(9, "sigenergy")])).toEqual({
      ok: true,
      deviceId: 9,
    });
  });
});

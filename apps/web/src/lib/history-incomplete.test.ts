import { describe, expect, test } from "bun:test";

import {
  type IncompleteRange,
  incompleteRangeFrom,
  noticeKey,
  withNotice,
} from "./history-incomplete";

const REFUSAL = {
  error: "history_incomplete",
  reason: "retention",
  from: "2026-06-01T00:00:00.000Z",
  tier: "minute",
  message: "The minute tier keeps 90 days; this window starts before that.",
};

describe("incompleteRangeFrom", () => {
  test("the server's refusal comes back as a notice", () => {
    expect(incompleteRangeFrom(422, REFUSAL)).toEqual({
      reason: "retention",
      from: "2026-06-01T00:00:00.000Z",
      tier: "minute",
      message: REFUSAL.message,
    });
  });

  test("a 200 is never a refusal, whatever its body says", () => {
    expect(incompleteRangeFrom(200, REFUSAL)).toBeNull();
  });

  test("an ordinary 422 is NOT one — a mistyped date is not missing history", () => {
    // The reason this is keyed on the body's marker and not on the status: 422 is
    // used for plain validation elsewhere in this API, and reporting one of those
    // as "your history is missing" sends the operator hunting for a migration.
    expect(incompleteRangeFrom(422, { error: "Invalid range" })).toBeNull();
  });

  test("no body, a null body and a string body are all not refusals", () => {
    expect(incompleteRangeFrom(422, undefined)).toBeNull();
    expect(incompleteRangeFrom(422, null)).toBeNull();
    expect(incompleteRangeFrom(422, "history_incomplete")).toBeNull();
  });

  test("a refusal with no usable `from` is DROPPED rather than shown", () => {
    // `from` is the only actionable thing in the notice. Without it the banner
    // would render "history before Invalid Date is missing", which is worse than
    // saying nothing — it looks like a bug in the app, not a fact about the data.
    expect(incompleteRangeFrom(422, { ...REFUSAL, from: undefined })).toBeNull();
    expect(incompleteRangeFrom(422, { ...REFUSAL, from: 1_759_000_000 })).toBeNull();
    expect(incompleteRangeFrom(422, { ...REFUSAL, from: "whenever" })).toBeNull();
  });

  test("missing reason and tier degrade to 'unknown' — the DATE still gets through", () => {
    const notice = incompleteRangeFrom(422, { error: "history_incomplete", from: REFUSAL.from });
    expect(notice).toEqual({
      reason: "unknown",
      from: REFUSAL.from,
      tier: "unknown",
      message: "",
    });
  });
});

describe("de-duplication", () => {
  const notice = (from: string, tier: string): IncompleteRange => ({
    reason: "retention",
    from,
    tier,
    message: "",
  });

  test("the key is the tier and the boundary — what distinguishes two problems", () => {
    expect(noticeKey(notice("2026-06-01T00:00:00.000Z", "minute"))).toBe(
      "minute 2026-06-01T00:00:00.000Z",
    );
  });

  test("the same refusal twice is one notice, and the SAME array", () => {
    // A dashboard mount fires a dozen range reads and several fail identically.
    // Returning the same reference is what stops the banner repainting per refusal.
    const one = notice("2026-06-01T00:00:00.000Z", "minute");
    const after = withNotice([one], notice("2026-06-01T00:00:00.000Z", "minute"));
    expect(after).toHaveLength(1);
    expect(after).toBe(after);
    expect(withNotice([one], one)).toEqual([one]);
  });

  test("the same boundary at a DIFFERENT tier is a different problem", () => {
    // A year-long window is complete at day resolution and truncated at minute
    // resolution, and the honest answer to the second is "ask for a wider bucket".
    const after = withNotice(
      [notice("2026-06-01T00:00:00.000Z", "minute")],
      notice("2026-06-01T00:00:00.000Z", "raw"),
    );
    expect(after).toHaveLength(2);
  });

  test("a different boundary at the same tier is too", () => {
    const after = withNotice(
      [notice("2026-06-01T00:00:00.000Z", "minute")],
      notice("2026-07-01T00:00:00.000Z", "minute"),
    );
    expect(after).toHaveLength(2);
  });

  test("the first notice lands on an empty list", () => {
    expect(withNotice([], notice("2026-06-01T00:00:00.000Z", "day"))).toHaveLength(1);
  });

  test("a differing reason on the same boundary does not add a second line", () => {
    const existing = notice("2026-06-01T00:00:00.000Z", "day");
    const after = withNotice([existing], { ...existing, reason: "migration" });
    expect(after).toHaveLength(1);
  });
});

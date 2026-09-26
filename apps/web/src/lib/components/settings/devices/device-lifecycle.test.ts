import { describe, expect, test } from "bun:test";

import { deleteOutcome, splitRetired } from "./device-lifecycle";
import type { DeviceView } from "./device-types";

const device = (id: number, retiredAt: string | null = null) => ({ id, retiredAt }) as DeviceView;

describe("what a DELETE /api/devices/:id answer means for the dialog", () => {
  test("a body is a deletion", () => {
    expect(deleteOutcome({ data: { ok: true, id: 3 }, error: null })).toEqual({ kind: "deleted" });
  });

  // The one refusal the dialog answers with a different offer rather than a
  // toast: the device recorded readings, so retiring is what keeps them.
  test("a 409 naming the history field asks for retirement instead", () => {
    const error = { status: 409, value: { error: "has history", field: "history" } };
    expect(deleteOutcome({ data: null, error })).toEqual({ kind: "history" });
  });

  test("any other refusal carries the server's reason", () => {
    const error = {
      status: 409,
      value: { error: "this device is the one being polled", field: null },
    };
    expect(deleteOutcome({ data: null, error })).toEqual({
      kind: "refused",
      reason: "this device is the one being polled",
    });
  });

  test("a failure with no body still refuses, with no reason rather than '[object Object]'", () => {
    expect(deleteOutcome({ data: null, error: null })).toEqual({ kind: "refused", reason: null });
    expect(deleteOutcome({ data: null, error: { status: 500, value: {} } })).toEqual({
      kind: "refused",
      reason: null,
    });
  });
});

describe("the retired devices fold away under their own disclosure", () => {
  test("splits in service from retired, keeping the order of each", () => {
    const rows = [device(1), device(2, "2026-01-01"), device(3), device(4, "2026-02-01")];
    const { active, retired } = splitRetired(rows);
    expect(active.map((d) => d.id)).toEqual([1, 3]);
    expect(retired.map((d) => d.id)).toEqual([2, 4]);
  });

  test("an empty list is two empty halves", () => {
    expect(splitRetired([])).toEqual({ active: [], retired: [] });
  });
});

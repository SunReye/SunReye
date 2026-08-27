import { describe, expect, test } from "bun:test";

import { computeExprInputs } from "./profile-data";

describe("computeExprInputs", () => {
  test("extracts the read keys of every expression kind", () => {
    expect(computeExprInputs({ sum: ["a", "b"] })).toEqual(["a", "b"]);
    expect(computeExprInputs({ diff: ["a", "b"] })).toEqual(["a", "b"]);
    expect(computeExprInputs({ scale: ["a", 0.1] })).toEqual(["a"]);
    expect(computeExprInputs({ combine: { add: ["a", "b"], sub: ["c"] } })).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(computeExprInputs({ combine: { add: ["a"] } })).toEqual(["a"]);
    expect(computeExprInputs({ clamp: { key: "a", min: 0 } })).toEqual(["a"]);
    expect(computeExprInputs({ ratio: { num: ["a"], den: ["b", "c"], scale: 100 } })).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

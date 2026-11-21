import { expect, test } from "bun:test";
import { levelKey } from "./level-key.ts";

test("a route's key is a named level, a record's id, or else the list", () => {
  const named = ["add", "topology"] as const;

  expect(levelKey("add", named)).toBe("add");
  expect(levelKey("12", named)).toBe("12");
  expect(levelKey("list", named)).toBe("list");
  expect(levelKey("nonsense", named)).toBe("list");
});

import { expect, test } from "bun:test";
import { passwordTooLong } from "./password";

test.each([
  ["72 ASCII", "x".repeat(72), false],
  ["36 two-byte (72 bytes)", "é".repeat(36), false],
  ["73 ASCII", "x".repeat(73), true],
  ["37 two-byte (74 bytes)", "é".repeat(37), true],
  ["empty", "", false],
])("%s", (_, password, tooLong) => {
  expect(passwordTooLong(password)).toBe(tooLong);
});

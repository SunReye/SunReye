import { expect, test } from "bun:test";
import * as m from "$lib/paraglide/messages";
import { passwordRefusal } from "./password";

// The core counts characters for the minimum, UTF-8 bytes for the maximum and refuses NUL.
test.each([
  ["8 ASCII", "x".repeat(8), undefined],
  ["72 ASCII", "x".repeat(72), undefined],
  ["36 two-byte (72 bytes)", "é".repeat(36), undefined],
  ["7 ASCII", "x".repeat(7), m.auth_password_min()],
  ["empty", "", m.auth_password_min()],
  ["four emoji (8 UTF-16 units)", "😀".repeat(4), m.auth_password_min()],
  ["73 ASCII", "x".repeat(73), m.auth_password_max()],
  ["37 two-byte (74 bytes)", "é".repeat(37), m.auth_password_max()],
  ["NUL inside", "abcdefgh\0abcdefgh", m.auth_password_nul()],
  ["NUL as byte 72", `${"x".repeat(71)}\0`, m.auth_password_nul()],
])("%s", (_, password, refusal) => {
  expect(passwordRefusal(password)).toBe(refusal);
});

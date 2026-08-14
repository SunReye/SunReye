import { describe, expect, test } from "bun:test";
import { payloadOrNull } from "./api-payload";

type Weather = { temperature: number; unit: string };

describe("payloadOrNull", () => {
  // The bug this exists for: Elysia serializes a handler that returns `null`
  // as an EMPTY body with no content-type, and Eden hands that back as the
  // string "". `data ?? null` keeps that "" (it is not nullish), so a
  // `weather !== null` guard rendered the tile against a string — printing
  // "NaN undefined" where the temperature belonged.
  test("an empty-string body (Elysia’s null) reads as no data", () => {
    expect(payloadOrNull<Weather>("")).toBe(null);
  });

  test("a whitespace-only body reads as no data", () => {
    expect(payloadOrNull<Weather>("   ")).toBe(null);
  });

  test("an explicit null reads as no data", () => {
    expect(payloadOrNull<Weather>(null)).toBe(null);
  });

  test("undefined (a failed request) reads as no data", () => {
    expect(payloadOrNull<Weather>(undefined)).toBe(null);
  });

  test('the literal string "null" reads as no data', () => {
    expect(payloadOrNull<Weather>("null")).toBe(null);
  });

  test("an object payload passes through unchanged", () => {
    const payload = { temperature: 21, unit: "°C" };
    expect(payloadOrNull<Weather>(payload)).toBe(payload);
  });

  test("an array payload passes through unchanged", () => {
    const rows = [{ bucket: "2026-08-14", value: 1 }];
    expect(payloadOrNull<typeof rows>(rows)).toBe(rows);
  });

  test("a scalar body is not a payload", () => {
    expect(payloadOrNull<Weather>(42)).toBe(null);
    expect(payloadOrNull<Weather>(true)).toBe(null);
  });

  test("an error envelope is still an object — this only drops non-objects", () => {
    const err = { error: "boom" };
    expect(payloadOrNull<{ error: string }>(err)).toBe(err);
  });
});

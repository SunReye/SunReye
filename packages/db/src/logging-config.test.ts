import { describe, expect, test } from "bun:test";
import { defaultLogging, loggingConfigSchema } from "./logging-config";

describe("loggingConfigSchema", () => {
  test("an empty document follows the boot default", () => {
    expect(loggingConfigSchema.parse({})).toEqual({ level: null });
    expect(defaultLogging).toEqual({ level: null });
  });

  test("accepts each LogTape severity", () => {
    for (const level of ["trace", "debug", "info", "warning", "error", "fatal"]) {
      expect(loggingConfigSchema.parse({ level }).level).toBe(level);
    }
  });

  test("refuses a level LogTape does not have", () => {
    expect(loggingConfigSchema.safeParse({ level: "warn" }).success).toBe(false);
    expect(loggingConfigSchema.safeParse({ level: "" }).success).toBe(false);
  });
});

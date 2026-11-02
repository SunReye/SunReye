import { describe, expect, it } from "bun:test";
import { kindValueClass } from "./widgets";

describe("kindValueClass", () => {
  it("mutes a setting, since it is not a reading", () => {
    expect(kindValueClass("setting")).toBe("text-muted-foreground");
  });

  it("renders cumulative and every other kind in the foreground colour", () => {
    expect(kindValueClass("cumulative")).toBe("text-foreground");
    expect(kindValueClass("measurement")).toBe("text-foreground");
    expect(kindValueClass("status")).toBe("text-foreground");
  });
});

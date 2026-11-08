import { describe, expect, it } from "bun:test";
import { imageTags } from "./image-tags";

describe("imageTags", () => {
  it("tags a 4.x release by version and major, never `latest`", () => {
    expect(imageTags("4.0.0")).toEqual(["4.0.0", "4"]);
    expect(imageTags("4.12.3")).toEqual(["4.12.3", "4"]);
  });

  it("keeps `latest` on 3.x, so pulling it still yields 3.x", () => {
    expect(imageTags("3.9.1")).toEqual(["3.9.1", "3.9", "latest"]);
  });

  it("refuses a major other than 3 or 4", () => {
    expect(() => imageTags("2.0.0")).toThrow("3.x or 4.x");
    expect(() => imageTags("5.0.0")).toThrow("3.x or 4.x");
  });

  it.each([
    "",
    "4",
    "4.0",
    "v4.0.0",
    "4.0.0-beta.1",
    "4.0.0+build",
    "4.0.0.1",
    "04.0.0",
    "4.00.0",
    "4.0.x",
    " 4.0.0",
  ])("refuses the malformed version %p", (version) => {
    expect(() => imageTags(version)).toThrow("not a release version");
  });
});

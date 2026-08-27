import { describe, expect, it } from "bun:test";
import { bakedPublicEnv } from "./static-build-env";

describe("bakedPublicEnv", () => {
  // adapter-static writes _app/env.js at BUILD time, so any PUBLIC_* value
  // present then is frozen into the shipped bundle. In the single-binary
  // deployment the dashboard is same-origin, and a baked PUBLIC_SERVER_URL
  // sends every API call and the live socket to a hardcoded host instead —
  // working on the build machine, broken on every user's.
  it("names each PUBLIC_ var that got a non-empty value", () => {
    const js = 'export const env={PUBLIC_SERVER_URL:"http://localhost:3000"}';
    expect(bakedPublicEnv(js)).toEqual(["PUBLIC_SERVER_URL"]);
  });

  it("accepts an env module with no values baked", () => {
    expect(bakedPublicEnv("export const env={}")).toEqual([]);
  });

  it("treats an empty string as not baked", () => {
    expect(bakedPublicEnv('export const env={PUBLIC_SERVER_URL:""}')).toEqual([]);
  });

  it("reports every baked var, not just the first", () => {
    const js = 'export const env={PUBLIC_SERVER_URL:"http://x",PUBLIC_OTHER:"y"}';
    expect(bakedPublicEnv(js)).toEqual(["PUBLIC_OTHER", "PUBLIC_SERVER_URL"]);
  });

  it("reads quoted keys and single quotes too", () => {
    expect(bakedPublicEnv(`export const env={'PUBLIC_A':'v',"PUBLIC_B":"w"}`)).toEqual([
      "PUBLIC_A",
      "PUBLIC_B",
    ]);
  });

  it("ignores a var that merely mentions PUBLIC_ in its value", () => {
    expect(bakedPublicEnv('export const env={PUBLIC_A:"see PUBLIC_B for this"}')).toEqual([
      "PUBLIC_A",
    ]);
  });
});

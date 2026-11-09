import { expect, test } from "bun:test";
import { loadProfileWasm } from "./profile-wasm.ts";

test("the profile WASM reports the current schema", async () => {
  const profile = await loadProfileWasm();
  expect(profile.schema()).toBe(1);
});

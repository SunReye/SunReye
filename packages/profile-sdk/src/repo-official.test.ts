import { expect, test } from "bun:test";

import type { ProfileData } from "@SunReye/inverter-core";

import { buildRepo } from "./repo";

const OFFICIAL = new URL("../../../crates/sunreye/profiles/official.json", import.meta.url);

// The version bump hashes serialized profile data only: regenerating the SDK's types, or a type
// change that left the data alone, must not move any published version.
test("rebuilding the official profiles from their published output bumps no version", async () => {
  const bundle = (await Bun.file(OFFICIAL).json()) as { profiles: { profile: ProfileData }[] };
  const published = bundle.profiles.map((p) => p.profile);
  const previous = new Map(published.map((p) => [p.id, p]));
  const built = buildRepo(published, { previous });
  expect(built.issues).toEqual([]);
  expect(built.versioning.map((v) => v.status)).toEqual(published.map(() => "unchanged"));
  expect(built.versioning.map((v) => v.version)).toEqual(published.map((p) => p.version));
});

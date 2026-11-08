import { expect, test } from "bun:test";

import { PROFILE_TYPES_FILE, renderProfileTypes } from "../scripts/gen-profile";
import { ROLE_CATALOG, ROLE_NAMES } from "./profile.gen";

const ROOT = new URL("../../../", import.meta.url);

async function ndjson(file: string): Promise<unknown[]> {
  const text = await Bun.file(new URL(`fixtures/oracle/${file}`, ROOT)).text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("profile.gen.ts is generated from the committed OpenAPI document", async () => {
  const committed = await Bun.file(PROFILE_TYPES_FILE).text();
  // Stale types name the fix: a core type moved and the SDK did not follow.
  expect(committed, "run `bun run --cwd packages/inverter-core gen:profile`").toBe(
    await renderProfileTypes(),
  );
});

test("the role catalogue names the kind and plant fold of every role the 2.x engine knows", async () => {
  const [kinds = {}] = (await ndjson("role-kinds.ndjson")) as Record<string, string>[];
  const [folds = {}] = (await ndjson("role-aggregates.ndjson")) as Record<string, string>[];
  const catalogue: Record<string, { kind: string; aggregate: string }> = ROLE_CATALOG;
  const pick = (field: "kind" | "aggregate") =>
    Object.fromEntries(Object.entries(catalogue).map(([role, spec]) => [role, spec[field]]));
  expect(pick("kind")).toEqual(kinds);
  expect(pick("aggregate")).toEqual(folds);
  expect<string[]>(ROLE_NAMES).toEqual(Object.keys(kinds));
});

test("a role spec states what an author must map", () => {
  expect(ROLE_CATALOG["pv.string.power"]).toEqual({
    kind: "measurement",
    unitHint: "W",
    aggregate: "per-device",
    indexed: true,
  });
  expect(ROLE_CATALOG["setting.work_mode"]).toMatchObject({
    writable: true,
    needsEnumLabels: true,
  });
  expect(ROLE_CATALOG["ev.charge.power"]).toMatchObject({ deviceClass: "charger" });
});

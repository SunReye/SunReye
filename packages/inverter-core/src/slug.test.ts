/**
 * The slug's behaviour, in the one place the slug now lives.
 *
 * These cases are the union of the two suites that used to guard the two copies
 * (`apps/server/src/inverter/provision.test.ts` and `apps/web/src/lib/slug.test.ts`).
 * The source-text "are these two files identical" test that stood beside them is
 * gone with the copy it was watching.
 */

import { describe, expect, test } from "bun:test";
import { SLUG_MAX, slugify } from "./slug";

describe("slugify", () => {
  test("makes a stable machine name out of a typed one", () => {
    expect(slugify("Haus Sud")).toBe("haus-sud");
    expect(slugify("  My Plant  ")).toBe("my-plant");
    expect(slugify("A/B\\C")).toBe("a-b-c");
  });

  test("diacritics are FOLDED, not dropped — a German name stays readable", () => {
    expect(slugify("Haus Süd")).toBe("haus-sud");
    expect(slugify("Ökostrom")).toBe("okostrom");
    expect(slugify("Haus Müller — Dach Süd")).toBe("haus-muller-dach-sud");
  });

  test("a run of punctuation collapses to one dash, and never leads or trails", () => {
    expect(slugify("  --Haus // Süd!! ")).toBe("haus-sud");
    expect(slugify("---x---")).toBe("x");
  });

  test('a name with nothing to keep is "" — the case the forms must refuse', () => {
    // Not a thrown error and not a substitute: `<prefix>//<topic>` is not a topic,
    // and the caller with the meaning ("plant", "inverter") owns the fallback.
    expect(slugify("!!!")).toBe("");
    expect(slugify("")).toBe("");
  });

  test("it never emits more than SLUG_MAX characters, and never a trailing dash", () => {
    expect(slugify("x".repeat(200)).length).toBeLessThanOrEqual(SLUG_MAX);
    const long = slugify(`${"a".repeat(SLUG_MAX - 1)} bbbb`);
    expect(long.length).toBeLessThanOrEqual(SLUG_MAX);
    expect(long.endsWith("-")).toBe(false);
  });

  test("digits survive — an inverter is often named by its model number", () => {
    expect(slugify("Deye SG05LP3-EU")).toBe("deye-sg05lp3-eu");
  });

  test("SLUG_MAX is the ceiling the name forms refuse a longer name on", () => {
    expect(SLUG_MAX).toBe(48);
  });
});

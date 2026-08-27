/**
 * The client's slug derivation, and its AGREEMENT with the server's.
 *
 * The behaviour cases are ordinary. The last case is the one that matters: the web
 * app cannot import `apps/server/src/inverter/provision.ts` (it depends on no
 * server package), so `slugify` is duplicated — and a duplicate that drifts turns
 * the onboarding form's live preview into a promise the server does not keep, for
 * a value that is frozen into every MQTT topic the moment it is submitted.
 *
 * Both function bodies are extracted from disk and compared. A source-text
 * assertion is the right layer here for once: the claim is literally "these two
 * files say the same thing", not "this function behaves a certain way", and no
 * amount of behavioural coverage on one side can prove anything about the other.
 */

import { describe, expect, test } from "bun:test";

import { SLUG_MAX, slugify } from "./slug";

const SERVER = new URL("../../../server/src/inverter/provision.ts", import.meta.url);
const CLIENT = new URL("./slug.ts", import.meta.url);

const serverSource = await Bun.file(SERVER).text();
const clientSource = await Bun.file(CLIENT).text();

describe("slugify", () => {
  test("a plain name becomes a topic segment", () => {
    expect(slugify("Haus Sud")).toBe("haus-sud");
  });

  test("diacritics are FOLDED, not dropped — a German name stays readable", () => {
    expect(slugify("Haus Süd")).toBe("haus-sud");
    expect(slugify("Ökostrom")).toBe("okostrom");
  });

  test("a run of punctuation collapses to one dash, and never leads or trails", () => {
    expect(slugify("  --Haus // Süd!! ")).toBe("haus-sud");
  });

  test('a name with nothing to keep is "" — the case the form must refuse', () => {
    // Not a thrown error and not a substitute: `<prefix>//<topic>` is not a topic,
    // and the caller with the meaning ("plant", "inverter") owns the fallback.
    expect(slugify("!!!")).toBe("");
    expect(slugify("")).toBe("");
  });

  test("it never emits more than SLUG_MAX characters, and never a trailing dash", () => {
    const long = slugify(`${"a".repeat(SLUG_MAX - 1)} bbbb`);
    expect(long.length).toBeLessThanOrEqual(SLUG_MAX);
    expect(long.endsWith("-")).toBe(false);
  });

  test("digits survive — an inverter is often named by its model number", () => {
    expect(slugify("Deye SG05LP3-EU")).toBe("deye-sg05lp3-eu");
  });
});

describe("agreement with the server", () => {
  /** One function's body, as written, with indentation and blank lines removed. */
  function body(source: string, name: string): string {
    const at = source.indexOf(`export function ${name}(text: string): string {`);
    expect(at, `${name} is not in this file`).toBeGreaterThan(-1);
    const from = source.indexOf("{", at) + 1;
    const to = source.indexOf("\n}", from);
    expect(to).toBeGreaterThan(from);
    return source
      .slice(from, to)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("\n");
  }

  const server = serverSource;
  const client = clientSource;

  test("both files are really there — an empty read would pass every case below", () => {
    expect(server.length).toBeGreaterThan(1000);
    expect(client.length).toBeGreaterThan(200);
  });

  test("the two slugify bodies are identical, character for character", () => {
    expect(body(client, "slugify")).toBe(body(server, "slugify"));
  });

  test("and so is SLUG_MAX — the server refuses a longer NAME on this number", () => {
    const serverMax = server.match(/export const SLUG_MAX = (\d+);/);
    expect(serverMax).not.toBeNull();
    expect(Number(serverMax![1])).toBe(SLUG_MAX);
  });
});

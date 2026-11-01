import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generate, oracleDatabaseUrl, type GenerateDeps } from "./generate";

describe("oracleDatabaseUrl", () => {
  test("no explicit URL leaves the choice to the test harness, which only builds sunreye_dbtest", () => {
    expect(oracleDatabaseUrl([], {})).toBeNull();
  });

  test("accepts a URL that names sunreye_dbtest, from a flag or the environment", () => {
    const url = "postgresql://postgres:x@localhost:5441/sunreye_dbtest";
    expect(oracleDatabaseUrl(["--database-url", url], {})).toBe(url);
    expect(oracleDatabaseUrl([], { ORACLE_DATABASE_URL: url })).toBe(url);
  });

  test("refuses any other database, naming it", () => {
    for (const name of ["SunReye", "postgres", "sunreye_dbtest_archive", "sunreye_dbtest2"]) {
      const url = `postgresql://postgres:x@localhost:5432/${name}`;
      expect(() => oracleDatabaseUrl(["--database-url", url], {})).toThrow(
        `Refusing to generate against ${name}`,
      );
    }
  });

  test("refuses a URL that names no database", () => {
    expect(() =>
      oracleDatabaseUrl([], { ORACLE_DATABASE_URL: "postgresql://postgres:x@localhost:5432" }),
    ).toThrow("Refusing to generate against (no database)");
  });

  test("the flag wins over the environment, and both are checked", () => {
    const good = "postgresql://h/sunreye_dbtest";
    expect(() =>
      oracleDatabaseUrl(["--database-url", good], { ORACLE_DATABASE_URL: "postgresql://h/prod" }),
    ).not.toThrow();
    expect(() =>
      oracleDatabaseUrl(["--database-url", "postgresql://h/prod"], { ORACLE_DATABASE_URL: good }),
    ).toThrow("Refusing");
  });
});

describe("generate", () => {
  let out = "";
  beforeAll(async () => {
    out = await mkdtemp(join(tmpdir(), "oracle-generate-"));
  });
  afterAll(() => rm(out, { recursive: true, force: true }));

  const deps = (calls: string[], over: Partial<GenerateDeps> = {}): GenerateDeps => ({
    out,
    profilesDir: () => "/profiles",
    transport: async () => {
      calls.push("transport");
      return { "transport.ndjson": "t\n" };
    },
    profiles: async (dir) => {
      calls.push(`profiles:${dir}`);
      return { "profile-decode.ndjson": "p\n" };
    },
    databaseGroups: async (url) => {
      calls.push(`db:${url}`);
      return 0;
    },
    log: () => {},
    ...over,
  });

  test("writes the two database-free groups, then runs the database groups", async () => {
    const calls: string[] = [];
    expect(await generate([], {}, deps(calls))).toBe(0);
    expect(calls).toEqual(["transport", "profiles:/profiles", "db:null"]);
    expect(await readFile(join(out, "transport.ndjson"), "utf8")).toBe("t\n");
    expect(await readFile(join(out, "profile-decode.ndjson"), "utf8")).toBe("p\n");
  });

  test("passes an explicit database URL through to the database groups", async () => {
    const calls: string[] = [];
    const url = "postgresql://h/sunreye_dbtest";
    await generate(["--database-url", url], {}, deps(calls));
    expect(calls.at(-1)).toBe(`db:${url}`);
  });

  test("refuses a foreign database before building or writing anything", async () => {
    const calls: string[] = [];
    await expect(
      generate(["--database-url", "postgresql://h/SunReye"], {}, deps(calls)),
    ).rejects.toThrow("Refusing to generate against SunReye");
    expect(calls).toEqual([]);
  });

  test("fails loudly when there is no profile repository to decode against", async () => {
    const calls: string[] = [];
    await expect(generate([], {}, deps(calls, { profilesDir: () => null }))).rejects.toThrow(
      "SUNREYE_PROFILES_DIR",
    );
    expect(calls).toEqual([]);
  });
});

describe("runDatabaseGroups", () => {
  test("runs in write mode, on the URL it was given, and returns the exit code", async () => {
    const { runDatabaseGroups } = await import("./generate");
    const check = 'test "$ORACLE_WRITE" = 1 && test "$DB_TEST_URL" = postgresql://h/sunreye_dbtest';
    expect(await runDatabaseGroups("postgresql://h/sunreye_dbtest", ["sh", "-c", check], {})).toBe(
      0,
    );
    expect(await runDatabaseGroups("postgresql://h/other", ["sh", "-c", check], {})).toBe(1);
  });
});

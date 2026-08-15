import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pg-proxy";

import * as schema from "./auth";
import { account, apikey, session, user, verification } from "./auth";

/** The columns of a table, keyed by their SQL name. */
const columns = (table: Parameters<typeof getTableConfig>[0]) =>
  new Map(getTableConfig(table).columns.map((c) => [c.name, c]));

/** `{ column → referenced column }` plus the delete rule, for one table's FKs. */
const foreignKeys = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).foreignKeys.map((fk) => {
    const ref = fk.reference();
    return {
      column: ref.columns[0]?.name,
      foreignTable: getTableConfig(ref.foreignTable).name,
      foreignColumn: ref.foreignColumns[0]?.name,
      onDelete: fk.onDelete,
    };
  });

const indexNames = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).indexes.map((i) => i.config.name);

describe("ownership of auth rows", () => {
  // A session, account or API key that outlives its user is a credential with no
  // owner — it would still authenticate. The cascade is the guard, and it is
  // declared here, so it is asserted here.
  test("every user-owned table cascades on user delete", () => {
    expect(foreignKeys(session)).toEqual([
      { column: "user_id", foreignTable: "user", foreignColumn: "id", onDelete: "cascade" },
    ]);
    expect(foreignKeys(account)).toEqual([
      { column: "user_id", foreignTable: "user", foreignColumn: "id", onDelete: "cascade" },
    ]);
    expect(foreignKeys(apikey)).toEqual([
      { column: "reference_id", foreignTable: "user", foreignColumn: "id", onDelete: "cascade" },
    ]);
  });

  test("verification rows belong to nobody and carry no foreign key", () => {
    expect(foreignKeys(verification)).toEqual([]);
  });

  test("the api key owner column is the plugin's `referenceId`, not `userId`", () => {
    // Better Auth's drizzle adapter maps on the *field name*; renaming this key
    // silently breaks every api-key write at runtime, not at compile time.
    expect(columns(apikey).has("reference_id")).toBe(true);
    expect(columns(apikey).has("user_id")).toBe(false);
  });
});

describe("lookup indexes", () => {
  test("every foreign key and hot lookup column is indexed", () => {
    expect(indexNames(session)).toEqual(["session_userId_idx"]);
    expect(indexNames(account)).toEqual(["account_userId_idx"]);
    expect(indexNames(verification)).toEqual(["verification_identifier_idx"]);
    // API keys are looked up by key on every `/api/v1` request.
    expect(indexNames(apikey)).toEqual(["apikey_referenceId_idx", "apikey_key_idx"]);
  });
});

describe("identity defaults", () => {
  test("a fresh user is an unverified, unbanned non-admin", () => {
    const cols = columns(user);

    expect(cols.get("role")?.default).toBe("user");
    expect(cols.get("email_verified")?.default).toBe(false);
    expect(cols.get("banned")?.default).toBe(false);
    // Ban details stay null until someone is actually banned.
    expect(cols.get("ban_reason")?.notNull).toBe(false);
    expect(cols.get("ban_expires")?.notNull).toBe(false);
  });

  test("email and session token are unique", () => {
    expect(columns(user).get("email")?.isUnique).toBe(true);
    expect(columns(session).get("token")?.isUnique).toBe(true);
  });

  test("an api key is enabled and rate limited from the first insert", () => {
    const cols = columns(apikey);

    expect(cols.get("enabled")?.default).toBe(true);
    expect(cols.get("rate_limit_enabled")?.default).toBe(true);
    expect(cols.get("request_count")?.default).toBe(0);
    // Unset plugin features stay null rather than defaulting to a limit.
    expect(cols.get("rate_limit_max")?.hasDefault).toBe(false);
    expect(cols.get("remaining")?.hasDefault).toBe(false);
  });
});

describe("timestamp bookkeeping", () => {
  test("session and account get no insert default for updated_at — the migration has none", () => {
    // Better Auth always supplies `updatedAt` on create. A default added here
    // and not in the committed migration is exactly the drift the CI gate hunts.
    expect(columns(session).get("updated_at")?.default).toBeUndefined();
    expect(columns(account).get("updated_at")?.default).toBeUndefined();
    // The tables this app writes itself default it to now() on insert.
    for (const table of [user, verification, apikey]) {
      expect(columns(table).get("updated_at")?.default).toBeDefined();
    }
  });

  test("created_at is stamped by the database on insert and never null", () => {
    for (const table of [session, account, user, verification, apikey]) {
      const createdAt = columns(table).get("created_at");
      expect(createdAt?.hasDefault).toBe(true);
      expect(createdAt?.notNull).toBe(true);
    }
  });

  test("updating a session or account refreshes updated_at with the current time", () => {
    const before = Date.now();

    for (const table of [session, account]) {
      const refreshed = columns(table).get("updated_at")?.onUpdateFn?.();
      expect(refreshed).toBeInstanceOf(Date);
      expect((refreshed as Date).getTime()).toBeGreaterThanOrEqual(before);
      expect((refreshed as Date).getTime()).toBeLessThanOrEqual(Date.now());
    }
  });
});

describe("relations", () => {
  const calls: string[] = [];
  const db = drizzle(
    async (sql: string) => {
      calls.push(sql.replace(/\s+/g, " ").trim());
      return { rows: [] };
    },
    { schema },
  );

  test("a user's sessions are joined on user_id", async () => {
    calls.length = 0;
    await db.query.user.findFirst({ with: { sessions: true } });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('"session"');
    expect(calls[0]).toContain("user_id");
  });

  test("a user's accounts and api keys are reachable in one query", async () => {
    calls.length = 0;
    await db.query.user.findFirst({ with: { accounts: true, apikeys: true } });

    expect(calls[0]).toContain('"account"');
    expect(calls[0]).toContain('"apikey"');
    expect(calls[0]).toContain("reference_id");
  });

  test("an api key resolves back to its owning user", async () => {
    calls.length = 0;
    await db.query.apikey.findFirst({ with: { user: true } });

    expect(calls[0]).toContain('"user"');
    expect(calls[0]).toContain("reference_id");
  });

  test("a session and an account each resolve back to their user", async () => {
    calls.length = 0;
    await db.query.session.findFirst({ with: { user: true } });
    await db.query.account.findFirst({ with: { user: true } });

    expect(calls).toHaveLength(2);
    for (const sql of calls) expect(sql).toContain('"user"');
  });
});

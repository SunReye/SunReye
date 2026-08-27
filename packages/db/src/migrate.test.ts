/**
 * The two "adopt an existing database" stamps in `migrate.ts`.
 *
 * Both record a migration as APPLIED WITHOUT EXECUTING IT, which is only ever
 * correct when the database already holds everything that migration would
 * create. Get the recognition wrong and the journal claims success over a
 * database that is missing tables — the failure mode is silent, permanent, and
 * on the single production instance the cost is its whole history.
 *
 * 2.0.0 is what makes this urgent. The stamps were written when "the baseline"
 * meant the 1.x schema, and they recognise a push-era database by
 * `metrics_raw` + `"user"` — which is exactly what a 1.2.0 PRODUCTION database
 * has. The 2.0.0 baseline creates a dimension spine (plants, connections,
 * devices, metric_keys) that no 1.x database has ever had, so on that database
 * the old recognition stamps a migration that was never run.
 *
 * Everything here runs against a fake `pg.Client` that answers the two
 * existence probes and records writes: what is under test is the DECISION, and
 * a decision is not a statement Postgres has an opinion about. The statements
 * themselves are covered by the database layer (`apps/server/db-tests`).
 */
import { describe, expect, test } from "bun:test";
import type { Client } from "pg";
import { applyTimescale, stampBaseline, stampTimescaleBootstrap } from "./migrate";

/** The journal as it ships in 2.0.0: one baseline entry. */
const ENTRIES = [{ idx: 0, when: 1787851083826, tag: "0000_baseline" }];

type FakeClient = Client & { readonly writes: string[]; readonly statements: string[] };

/** What the fake answers existence probes from. */
type Catalog = {
  /** Qualified names `to_regclass` resolves. */
  relations: Set<string>;
  /** `<table>.<column>` pairs that exist. */
  columns: Set<string>;
  /** Names already recorded in `public.timescale_migrations`. */
  timescaleApplied: string[];
};

/** Statements that write, so a test can assert nothing was stamped. */
const WRITES = /^\s*(insert|create|alter|drop|update|delete)/i;

/**
 * The rows a probe expects back, or null when this statement is not a probe
 * (in which case it is real DDL and the fake simply swallows it).
 */
function probeAnswer(
  text: string,
  params: unknown[] | undefined,
  catalog: Catalog,
): { rows: unknown[] } | null {
  if (text.includes("SELECT name FROM public.timescale_migrations")) {
    return { rows: catalog.timescaleApplied.map((name) => ({ name })) };
  }
  if (text.includes("to_regclass")) {
    return { rows: [{ oid: catalog.relations.has(String(params?.[0])) ? "16384" : null }] };
  }
  if (text.includes("information_schema.columns")) {
    const key = `${String(params?.[0])}.${String(params?.[1])}`;
    return { rows: catalog.columns.has(key) ? [{ present: true }] : [] };
  }
  return null;
}

/**
 * A `pg.Client` that exists only as a catalog.
 *
 * Every statement is recorded in `statements` (raw, comments included) and the
 * writing ones again in `writes` (whitespace-normalized), so a test can assert
 * both what was decided and what was sent.
 */
function fakeClient(
  options: { relations?: string[]; columns?: string[]; timescaleApplied?: string[] } = {},
): FakeClient {
  const catalog: Catalog = {
    relations: new Set(options.relations ?? []),
    columns: new Set(options.columns ?? []),
    timescaleApplied: options.timescaleApplied ?? [],
  };
  const statements: string[] = [];
  const writes: string[] = [];

  const client = {
    writes,
    statements,
    async query(text: string, params?: unknown[]) {
      statements.push(text);
      const probe = probeAnswer(text, params, catalog);
      if (probe !== null) return probe;
      if (WRITES.test(text)) writes.push(text.replace(/\s+/g, " ").trim());
      return { rows: [] };
    },
  };
  return client as unknown as FakeClient;
}

/** Everything the 2.0.0 baseline creates that no pre-2.0.0 database has. */
const DIMENSIONS = ["public.plants", "public.connections", "public.devices", "public.metric_keys"];

/** The shape a `drizzle-kit push` of the 2.0.0 schema leaves behind. */
const PUSH_ERA_2_0_0 = ["public.metrics_raw", "public.user", ...DIMENSIONS];

/** The shape the single production instance is actually in today. */
const PROD_1_2_0 = ["public.metrics_raw", "public.user", "public.minute_rollups"];

const stamped = (client: FakeClient) =>
  client.writes.filter((w) => w.startsWith("INSERT INTO drizzle.__drizzle_migrations"));

describe("stampBaseline", () => {
  test("stamps a push-era database that already holds the whole baseline", async () => {
    const client = fakeClient({ relations: PUSH_ERA_2_0_0 });
    await stampBaseline(client, ENTRIES);
    expect(stamped(client)).toHaveLength(1);
  });

  test("leaves a journaled database alone", async () => {
    const client = fakeClient({
      relations: ["drizzle.__drizzle_migrations", ...PUSH_ERA_2_0_0],
    });
    await stampBaseline(client, ENTRIES);
    expect(stamped(client)).toEqual([]);
  });

  test("leaves an empty database alone, so the migration runs for real", async () => {
    const client = fakeClient({ relations: [] });
    await stampBaseline(client, ENTRIES);
    expect(stamped(client)).toEqual([]);
  });

  // THE BUG. A 1.2.0 production database has metrics_raw and "user" and no
  // drizzle journal shape the 2.0.0 build recognises, but none of the dimension
  // tables — stamping there yields a database with no plants, connections,
  // devices or metric_keys whose journal says the baseline succeeded.
  test("refuses a 1.2.0 production database instead of stamping it", async () => {
    const client = fakeClient({ relations: PROD_1_2_0 });
    await expect(stampBaseline(client, ENTRIES)).rejects.toThrow(/dimension/i);
    expect(stamped(client)).toEqual([]);
  });

  test("refuses a HALF-migrated database — a partial dimension spine is not push era", async () => {
    const client = fakeClient({
      relations: ["public.metrics_raw", "public.user", "public.plants", "public.devices"],
    });
    await expect(stampBaseline(client, ENTRIES)).rejects.toThrow(/metric_keys/);
    expect(stamped(client)).toEqual([]);
  });

  test("names every missing table, so the operator can see what shape the database is in", async () => {
    const client = fakeClient({ relations: PROD_1_2_0 });
    const error = await stampBaseline(client, ENTRIES).catch((e: unknown) => e as Error);
    for (const table of DIMENSIONS) {
      expect((error as Error).message).toContain(table);
    }
  });

  test("an empty journal is still a hard error on a push-era database", async () => {
    const client = fakeClient({ relations: PUSH_ERA_2_0_0 });
    await expect(stampBaseline(client, [])).rejects.toThrow(/journal is empty/);
  });
});

describe("stampTimescaleBootstrap", () => {
  const BOOTSTRAP = "0000_baseline.sql";
  const recorded = (client: FakeClient) =>
    client.writes.filter((w) => w.startsWith("INSERT INTO public.timescale_migrations"));

  test("stamps when the 2.0.0 rollup generation is already there", async () => {
    const client = fakeClient({
      relations: ["public.metrics_raw", "public.minute_rollups"],
      columns: ["metrics_raw.device_id", "metrics_raw.metric_id"],
    });
    const applied = new Set<string>();
    await stampTimescaleBootstrap(client, BOOTSTRAP, applied);
    expect(recorded(client)).toHaveLength(1);
    expect(applied.has(BOOTSTRAP)).toBe(true);
  });

  test("does nothing on a fresh database — there are no aggregates to adopt", async () => {
    const client = fakeClient({ relations: [] });
    await stampTimescaleBootstrap(client, BOOTSTRAP, new Set());
    expect(recorded(client)).toEqual([]);
  });

  test("does nothing when the timescale journal already has rows", async () => {
    const client = fakeClient({ relations: ["public.minute_rollups"] });
    await stampTimescaleBootstrap(client, BOOTSTRAP, new Set(["0000_baseline.sql"]));
    expect(recorded(client)).toEqual([]);
  });

  // The same defect, one layer down: 1.x `minute_rollups` is keyed on a text
  // inverter_id and computes a plain average. Stamping the 2.0.0 baseline over
  // it records success for aggregates that were never created — and this path
  // is reachable without stampBaseline, via packages/db/src/setup-timescale.ts.
  test("refuses a 1.x rollup generation, which is keyed on inverter_id, not device_id", async () => {
    const client = fakeClient({
      relations: ["public.metrics_raw", "public.minute_rollups"],
      columns: ["metrics_raw.inverter_id", "metrics_raw.metric"],
    });
    await expect(stampTimescaleBootstrap(client, BOOTSTRAP, new Set())).rejects.toThrow(
      /device_id/,
    );
    expect(recorded(client)).toEqual([]);
  });

  test("a half-re-keyed metrics_raw is refused too", async () => {
    const client = fakeClient({
      relations: ["public.metrics_raw", "public.minute_rollups"],
      columns: ["metrics_raw.device_id"],
    });
    await expect(stampTimescaleBootstrap(client, BOOTSTRAP, new Set())).rejects.toThrow(
      /metric_id/,
    );
  });
});

/**
 * `applyTimescale`, against the SQL this package actually ships.
 *
 * Characterization rather than TDD: these cover code that was already correct
 * and became reachable when the stamps above were exposed. What they pin is the
 * ORDER, which `policies.sql` documents a dependency on — a compression policy
 * against an aggregate whose columnstore the structural file has not enabled
 * raises — and the "policies are settings, history is not" split, which is why
 * a second run must re-apply one and skip the other.
 */
describe("applyTimescale", () => {
  const BASELINE = "0000_baseline.sql";

  /**
   * A statement with its explanatory comment lines stripped.
   *
   * `splitStatements` keeps the comment block that precedes a statement, and
   * these files explain themselves at length — `policies.sql` discusses
   * `create_hypertable` in prose above a statement that does not call it. A
   * search over the raw text finds the prose and proves nothing.
   */
  const sqlOnly = (statement: string) =>
    statement
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

  const indexOf = (client: FakeClient, needle: string) =>
    client.statements.findIndex((s) => sqlOnly(s).includes(needle));

  test("a fresh database gets the structural file, then the policies", async () => {
    const client = fakeClient();
    await applyTimescale(client);

    const hypertable = indexOf(client, "create_hypertable(");
    const retention = indexOf(client, "add_retention_policy");
    expect(hypertable).toBeGreaterThanOrEqual(0);
    expect(retention).toBeGreaterThan(hypertable);
    expect(
      client.writes.filter((w) => w.includes("INSERT INTO public.timescale_migrations")),
    ).toHaveLength(1);
  });

  test("an already-applied structural file is skipped — but the policies are re-applied", async () => {
    const client = fakeClient({ timescaleApplied: [BASELINE] });
    await applyTimescale(client);

    expect(indexOf(client, "create_hypertable(")).toBe(-1);
    expect(indexOf(client, "add_retention_policy")).toBeGreaterThan(-1);
    expect(
      client.writes.filter((w) => w.includes("INSERT INTO public.timescale_migrations")),
    ).toEqual([]);
  });

  test("no comment-only chunk is ever sent as a statement", async () => {
    const client = fakeClient();
    await applyTimescale(client);
    // Both files separate sections with comment-only chunks; sending one is a
    // syntax error, so the splitter has to drop them.
    expect(client.statements.filter((s) => sqlOnly(s) === "")).toEqual([]);
    expect(client.statements.length).toBeGreaterThan(10);
  });
});

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
import {
  applyTimescale,
  cli,
  type MigrateRuntime,
  productionRuntime,
  readJournal,
  runMigrations,
  stampBaseline,
  stampTimescaleBootstrap,
} from "./migrate";

/** The journal as it ships in 2.0.0: one baseline entry. */
const ENTRIES = [{ idx: 0, when: 1787851083826, tag: "0000_baseline" }];

type FakeClient = Client & {
  readonly writes: string[];
  readonly statements: string[];
  /** Connection lifecycle, so a test can prove the client is always released. */
  readonly lifecycle: string[];
};

/** What the fake answers existence probes from. */
type Catalog = {
  /** Qualified names `to_regclass` resolves. */
  relations: Set<string>;
  /** `<table>.<column>` pairs that exist. */
  columns: Set<string>;
  /** Names already recorded in `public.timescale_migrations`. */
  timescaleApplied: string[];
  /**
   * `max(created_at)` in `drizzle.__drizzle_migrations` — the newest migration
   * the DATABASE has recorded, which is what the downgrade guard compares the
   * shipped journal against. `null` is a journal table with no rows.
   */
  journalMax: number | null;
};

/** Statements that write, so a test can assert nothing was stamped. */
const WRITES = /^\s*(insert|create|alter|drop|update|delete)/i;

/**
 * The probes the fake recognises, as a table: the fragment that identifies each
 * one, and the rows it answers with.
 *
 * A table rather than an if-chain so each probe's answer is a small function of
 * its own — the chain grew past the complexity ceiling once the downgrade guard's
 * `max(created_at)` probe joined it.
 */
const PROBES: readonly [
  fragment: string,
  answer: (catalog: Catalog, params: unknown[] | undefined) => unknown[],
][] = [
  [
    "SELECT name FROM public.timescale_migrations",
    (catalog) => catalog.timescaleApplied.map((name) => ({ name })),
  ],
  [
    // bigint, so it comes back as text — which is what makes `Number(null)` vs
    // `Number(undefined)` load-bearing in `latestJournaledInDb`.
    "max(created_at)",
    (catalog) => [{ max: catalog.journalMax === null ? null : String(catalog.journalMax) }],
  ],
  [
    "to_regclass",
    (catalog, params) => [{ oid: catalog.relations.has(String(params?.[0])) ? "16384" : null }],
  ],
  [
    "information_schema.columns",
    (catalog, params) =>
      catalog.columns.has(`${String(params?.[0])}.${String(params?.[1])}`)
        ? [{ present: true }]
        : [],
  ],
];

/**
 * The rows a probe expects back, or null when this statement is not a probe
 * (in which case it is real DDL and the fake simply swallows it).
 */
function probeAnswer(
  text: string,
  params: unknown[] | undefined,
  catalog: Catalog,
): { rows: unknown[] } | null {
  const probe = PROBES.find(([fragment]) => text.includes(fragment));
  return probe ? { rows: probe[1](catalog, params) } : null;
}

/**
 * A `pg.Client` that exists only as a catalog.
 *
 * Every statement is recorded in `statements` (raw, comments included) and the
 * writing ones again in `writes` (whitespace-normalized), so a test can assert
 * both what was decided and what was sent.
 */
function fakeClient(
  options: {
    relations?: string[];
    columns?: string[];
    timescaleApplied?: string[];
    journalMax?: number | null;
  } = {},
): FakeClient {
  const catalog: Catalog = {
    relations: new Set(options.relations ?? []),
    columns: new Set(options.columns ?? []),
    timescaleApplied: options.timescaleApplied ?? [],
    journalMax: options.journalMax ?? null,
  };
  const statements: string[] = [];
  const writes: string[] = [];
  const lifecycle: string[] = [];

  const client = {
    writes,
    statements,
    lifecycle,
    async connect() {
      lifecycle.push("connect");
    },
    async end() {
      lifecycle.push("end");
    },
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

// ---------------------------------------------------------------------------
// The runner itself: the journal it ships, the downgrade it refuses, and the
// order it does things in.
//
// `runMigrations` used to build its own `pg.Client`, which put all of this out
// of reach of a unit test — the only way in would have been `mock.module("pg")`,
// and that is process-global and permanent, so it would have installed a stub
// for every later file in a serial coverage run (CONTRIBUTING.md §6). Instead it
// takes a {@link MigrateRuntime}, defaulting to the production wiring, in the
// same shape as the `FloorIo` seam in `scripts/coverage-floor.ts`.
// ---------------------------------------------------------------------------

/** A runtime that hands back one fake client and records the steps taken. */
function fakeRuntime(
  client: FakeClient,
  options: { onExit?: (code: number) => never } = {},
): MigrateRuntime & { readonly steps: string[]; readonly urls: string[] } {
  const steps: string[] = [];
  const urls: string[] = [];
  return {
    steps,
    urls,
    createClient(databaseUrl: string) {
      urls.push(databaseUrl);
      steps.push("createClient");
      return client;
    },
    async applyDrizzle(_client, migrationsFolder) {
      steps.push(`applyDrizzle:${migrationsFolder}`);
    },
    exit(code: number): never {
      steps.push(`exit:${code}`);
      if (options.onExit) return options.onExit(code);
      throw new Error(`process.exit(${code})`);
    },
  };
}

/** Silence the runner's progress logs, keeping what it wrote to each stream. */
function quietly<T>(
  body: () => Promise<T>,
): Promise<{ value?: T; error?: unknown; err: string[] }> {
  const err: string[] = [];
  const realLog = console.log;
  const realError = console.error;
  console.log = () => {};
  console.error = (...a: unknown[]) => void err.push(a.join(" "));
  return body()
    .then((value) => ({ value, err }))
    .catch((error) => ({ error, err }))
    .finally(() => {
      console.log = realLog;
      console.error = realError;
    });
}

describe("readJournal", () => {
  test("reads the journal that ships beside this module", () => {
    const entries = readJournal();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]).toMatchObject({ idx: 0, tag: "0000_baseline" });
  });

  test("every entry carries the timestamp the downgrade guard compares", () => {
    for (const entry of readJournal()) {
      expect(Number.isFinite(entry.when)).toBe(true);
      expect(entry.when).toBeGreaterThan(0);
    }
  });

  test("entries are ordered oldest first, so `at(-1)` is really the newest", () => {
    const whens = readJournal().map((e) => e.when);
    expect([...whens].sort((a, b) => a - b)).toEqual(whens);
  });
});

describe("runMigrations: the downgrade guard", () => {
  /** A journal timestamp comfortably newer than anything this build ships. */
  const NEWER = Date.now() + 86_400_000;

  test("refuses a database migrated by a newer release, and applies nothing", async () => {
    const client = fakeClient({
      relations: ["drizzle.__drizzle_migrations", ...PUSH_ERA_2_0_0],
      journalMax: NEWER,
    });
    const runtime = fakeRuntime(client);
    const { error, err } = await quietly(() => runMigrations("postgres:///x", runtime));

    expect(String(error)).toContain("process.exit(1)");
    expect(runtime.steps).toContain("exit:1");
    // The refusal must happen before ANY migration is applied: an older server
    // writing to a newer schema is the direction that corrupts data silently.
    expect(runtime.steps.filter((s) => s.startsWith("applyDrizzle"))).toEqual([]);
    expect(client.writes).toEqual([]);
    expect(err.join("\n")).toContain("Refusing to start");
    expect(err.join("\n")).toContain("migrated by a newer SunReye release");
    // The client is released even on the refusal path.
    expect(client.lifecycle).toEqual(["connect", "end"]);
  });

  test("a database journaled at EXACTLY the shipped timestamp is not a downgrade", async () => {
    // The boundary: `<=` passes. An off-by-one here bricks every up-to-date
    // instance on restart.
    const shipped = readJournal().at(-1)!.when;
    const client = fakeClient({
      relations: ["drizzle.__drizzle_migrations", ...PUSH_ERA_2_0_0],
      journalMax: shipped,
    });
    const runtime = fakeRuntime(client);
    const { error } = await quietly(() => runMigrations("postgres:///x", runtime));

    expect(error).toBeUndefined();
    expect(runtime.steps).not.toContain("exit:1");
  });

  test("one millisecond newer than shipped IS a downgrade", async () => {
    const shipped = readJournal().at(-1)!.when;
    const client = fakeClient({
      relations: ["drizzle.__drizzle_migrations", ...PUSH_ERA_2_0_0],
      journalMax: shipped + 1,
    });
    const runtime = fakeRuntime(client);
    await quietly(() => runMigrations("postgres:///x", runtime));
    expect(runtime.steps).toContain("exit:1");
  });

  test("a journal table with no rows reads as 0, not as NaN", async () => {
    // `Number(null)` is 0 but `Number(undefined)` is NaN, and `NaN <= shipped`
    // is false — which would refuse to start on an empty journal table.
    const client = fakeClient({
      relations: ["drizzle.__drizzle_migrations", ...PUSH_ERA_2_0_0],
      journalMax: null,
    });
    const runtime = fakeRuntime(client);
    const { error } = await quietly(() => runMigrations("postgres:///x", runtime));
    expect(error).toBeUndefined();
    expect(runtime.steps).not.toContain("exit:1");
  });

  test("a database with no journal table at all is not a downgrade", async () => {
    const client = fakeClient({ relations: [] });
    const runtime = fakeRuntime(client);
    const { error } = await quietly(() => runMigrations("postgres:///x", runtime));
    expect(error).toBeUndefined();
    expect(runtime.steps).not.toContain("exit:1");
  });
});

describe("runMigrations: orchestration", () => {
  test("connects with the URL it was handed", async () => {
    const client = fakeClient({ relations: [] });
    const runtime = fakeRuntime(client);
    await quietly(() => runMigrations("postgres://u:p@h:5432/sunreye", runtime));
    expect(runtime.urls).toEqual(["postgres://u:p@h:5432/sunreye"]);
    expect(client.lifecycle).toEqual(["connect", "end"]);
  });

  test("stamps, then applies drizzle, then the timescale pipeline — in that order", async () => {
    const client = fakeClient({ relations: PUSH_ERA_2_0_0 });
    const runtime = fakeRuntime(client);
    await quietly(() => runMigrations("postgres:///x", runtime));

    const drizzleAt = runtime.steps.findIndex((s) => s.startsWith("applyDrizzle"));
    expect(drizzleAt).toBeGreaterThan(-1);
    // The baseline stamp has to land before drizzle's migrator looks at the
    // journal, or the migrator executes a baseline the database already has.
    const stampAt = client.statements.findIndex((s) =>
      s.includes("INSERT INTO drizzle.__drizzle_migrations"),
    );
    expect(stampAt).toBeGreaterThan(-1);
    // …and the timescale pipeline after it, since the aggregates read tables the
    // journaled migrations create.
    const timescaleAt = client.statements.findIndex((s) => s.includes("timescale_migrations"));
    expect(timescaleAt).toBeGreaterThan(stampAt);
  });

  test("hands drizzle the migrations folder the journal was read from", async () => {
    const client = fakeClient({ relations: [] });
    const runtime = fakeRuntime(client);
    await quietly(() => runMigrations("postgres:///x", runtime));
    const step = runtime.steps.find((s) => s.startsWith("applyDrizzle:"));
    expect(step).toBeDefined();
    expect(step).toContain("migrations");
  });

  test("releases the client even when a step throws", async () => {
    // A leaked connection on a failed migration keeps the next start from
    // acquiring the advisory lock, turning one failure into a wedged addon.
    const client = fakeClient({ relations: PROD_1_2_0 });
    const runtime = fakeRuntime(client);
    const { error } = await quietly(() => runMigrations("postgres:///x", runtime));

    expect(String(error)).toContain("Refusing to migrate");
    expect(client.lifecycle).toEqual(["connect", "end"]);
  });

  test("reports the schema it left the database at", async () => {
    const client = fakeClient({ relations: [] });
    const logs: string[] = [];
    const realLog = console.log;
    console.log = (...a: unknown[]) => void logs.push(a.join(" "));
    try {
      await runMigrations("postgres:///x", fakeRuntime(client));
    } finally {
      console.log = realLog;
    }
    expect(logs.join("\n")).toContain(`Schema is at ${readJournal().at(-1)!.tag}`);
  });
});

describe("productionRuntime", () => {
  test("builds a pg client for the URL, without connecting it", () => {
    const client = productionRuntime.createClient("postgres://u:p@localhost:1/none");
    expect(client).toBeDefined();
    expect(typeof client.connect).toBe("function");
    expect(typeof client.query).toBe("function");
  });

  test("applyDrizzle refuses a migrations folder that is not there", async () => {
    // The wiring has to fail loudly on a bad MIGRATIONS_DIR: the compiled addon
    // points that env var at files shipped beside the binary, and a silent
    // no-op would start the server on an unmigrated database.
    const client = fakeClient({ relations: [] });
    await expect(
      productionRuntime.applyDrizzle(client, "/nonexistent-migrations-dir"),
    ).rejects.toThrow();
  });

  test("exit is the process exit itself, not a wrapper around it", () => {
    // A wrapper would be a function no test could ever call.
    expect(typeof productionRuntime.exit).toBe("function");
  });
});

describe("cli", () => {
  test("a successful migration exits 0", async () => {
    const client = fakeClient({ relations: [] });
    const realLog = console.log;
    console.log = () => {};
    try {
      expect(await cli("postgres:///x", fakeRuntime(client))).toBe(0);
    } finally {
      console.log = realLog;
    }
  });

  test("a failed migration exits 1 and says the server will not start", async () => {
    // The whole point of the entry point: a half-migrated schema must never be
    // served. Swallowing the error and returning 0 would boot the server on it.
    const client = fakeClient({ relations: PROD_1_2_0 });
    const { value, err } = await quietly(() => cli("postgres:///x", fakeRuntime(client)));

    expect(value).toBe(1);
    expect(err.join("\n")).toContain("Migration failed — the server will not start");
    expect(err.join("\n")).toContain("Refusing to migrate");
  });

  test("the downgrade refusal also exits 1 rather than propagating", async () => {
    const client = fakeClient({
      relations: ["drizzle.__drizzle_migrations", ...PUSH_ERA_2_0_0],
      journalMax: Date.now() + 86_400_000,
    });
    const { value, err } = await quietly(() => cli("postgres:///x", fakeRuntime(client)));
    expect(value).toBe(1);
    expect(err.join("\n")).toContain("Refusing to start");
  });
});

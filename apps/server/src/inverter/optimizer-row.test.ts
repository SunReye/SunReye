import { describe, expect, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

import { OPTIMIZER_DEVICE_ID, OPTIMIZER_PROFILE } from "../automation/optimizer-device";
import { ensureOptimizerRow } from "./optimizer-row";

/**
 * `ensureOptimizerRow` — the production default behind
 * `RuntimeDeps.ensureOptimizerDevice`, over the REAL plant repository and a
 * client that answers from a queue.
 *
 * The client is a parameter, so nothing here is `mock.module`d: a stubbed
 * `@SunReye/db` installed by this suite once re-evaluated every module that
 * imported it, and bun's serial coverage then kept the re-run's empty numbers
 * for `./profiles.ts` — the whole of CI's 99 % floor, lost to test order.
 *
 * The distinction under test is the one its header names: `ensureDevice` is
 * `ON CONFLICT DO NOTHING` + SELECT, so it answers "the row is there" for a row
 * the operator RETIRED — while the roster read excludes exactly that row. A
 * registrar told "ready" about a retired device waits for an instance that is
 * never coming.
 */

const dialect = new PgDialect();

/** A client answering each statement with the next queued row set. */
function queueClient(queue: Array<Array<Record<string, unknown>>>) {
  const executed: string[] = [];
  const client = {
    async execute(query: SQL) {
      executed.push(dialect.sqlToQuery(query).sql);
      return { rows: queue.shift() ?? [] };
    },
  };
  return { client, executed };
}

/** The plant row as the driver hands it over. */
const plantRow = { id: "3", name: "Home", slug: "home", timeZone: "Europe/Berlin" };
/** The optimizer's device row, retired or not. */
const deviceRow = (retiredAt: Date | null) => ({
  id: "9",
  slug: OPTIMIZER_DEVICE_ID,
  name: "Optimizer",
  profileId: OPTIMIZER_PROFILE,
  role: "optimizer",
  unitId: "0",
  connectionId: null,
  retiredAt,
});

describe("ensureOptimizerRow", () => {
  test("a boot with no plant answers absent, and writes no device row", async () => {
    // Legal, not exceptional: the automation loop can be armed on an
    // onboarding-only boot, and taking it down over a missing row would be worse
    // than storing nothing until the next tick.
    const { client, executed } = queueClient([[]]);
    expect(await ensureOptimizerRow(client)).toBe("absent");
    expect(executed).toHaveLength(1);
    expect(executed[0]).toContain("from plants");
  });

  test("an in-service row is ready, upserted under the plant it belongs to", async () => {
    const { client, executed } = queueClient([[plantRow], [], [deviceRow(null)]]);
    expect(await ensureOptimizerRow(client)).toBe("ready");
    expect(executed[1]).toContain("insert into devices");
    expect(executed[1]).toContain("on conflict (plant_id, slug) do nothing");
  });

  test("a row the operator RETIRED is retired, not ready", async () => {
    // `ensureDevice` answers the row either way — it is `ON CONFLICT DO NOTHING`
    // plus a SELECT — while the roster read excludes a retired device. Reporting
    // "ready" here leaves the registrar waiting for an instance that is never
    // coming, and every decision it holds unstored.
    const { client } = queueClient([[plantRow], [], [deviceRow(new Date("2026-09-01T00:00:00Z"))]]);
    expect(await ensureOptimizerRow(client)).toBe("retired");
  });
});

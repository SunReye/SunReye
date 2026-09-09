import { describe, expect, test } from "bun:test";

import { withUpgradeClient } from "./upgrade-connect";

/** A connection that records what happened to it. */
function fakeClient(behaviour: { connectThrows?: boolean } = {}) {
  const events: string[] = [];
  return {
    events,
    client: {
      async connect() {
        events.push("connect");
        if (behaviour.connectThrows) throw new Error("ECONNREFUSED");
      },
      async query(text: string) {
        events.push(`query:${text}`);
        return { rows: [] };
      },
      async end() {
        events.push("end");
      },
    },
  };
}

describe("withUpgradeClient", () => {
  test("connects, runs the work on its own connection, and closes it", async () => {
    const fake = fakeClient();
    const result = await withUpgradeClient(
      "postgres://ignored",
      async (client) => {
        await client.query("select 1");
        return "done";
      },
      () => fake.client,
    );
    expect(result).toBe("done");
    expect(fake.events).toEqual(["connect", "query:select 1", "end"]);
  });

  test("the connection is CLOSED even when the work throws", async () => {
    // The caller is a fire-and-forget background task, so a rejection has no
    // handler of its own. A leaked socket per failed attempt exhausts
    // `max_connections` on the box the inverter is also talking to.
    const fake = fakeClient();
    await expect(
      withUpgradeClient(
        "postgres://ignored",
        async () => {
          throw new Error("relation does not exist");
        },
        () => fake.client,
      ),
    ).rejects.toThrow("relation does not exist");
    expect(fake.events).toEqual(["connect", "end"]);
  });

  test("a failed CONNECT does not try to close what was never opened", async () => {
    const fake = fakeClient({ connectThrows: true });
    await expect(
      withUpgradeClient(
        "postgres://ignored",
        async () => "unreachable",
        () => fake.client,
      ),
    ).rejects.toThrow("ECONNREFUSED");
    expect(fake.events).toEqual(["connect"]);
  });

  test("the client is handed on as a { query } client, values spread", async () => {
    // The shape is a CONTRACT with `./upgrade-120-run.ts` and `./replay-run.ts`: a
    // missing spread sends NO parameters rather than failing, which would replay
    // the wrong device's history.
    const fake = fakeClient();
    await withUpgradeClient(
      "postgres://ignored",
      async (client) => client.query("select $1", ["deye"]),
      () => fake.client,
    );
    expect(fake.events).toContain("query:select $1");
  });
});

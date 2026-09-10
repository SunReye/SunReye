import { describe, expect, test } from "bun:test";
import type { IntegrationRecord } from "@SunReye/db/integrations-store";

import { evccTopicRootFrom } from "./evcc-topic-root";

/**
 * Where the EVCC ingest gets its topic root now that the integration is a ROW.
 *
 * The DB round trip is `./evcc-topic-root.ts`'s other half; what is worth a test
 * is the RESOLUTION, because every one of its cases is a live install: an
 * upgrade that has not written a row yet (the setting still answers), a row that
 * has been written (it wins), and two ingests on one broker (the first one, and
 * this build subscribes for one).
 */

const row = (over: Partial<IntegrationRecord> = {}): IntegrationRecord =>
  ({
    id: 11,
    connectionId: 5,
    kind: "evcc-ingest",
    enabled: true,
    params: { topicRoot: "evcc" },
    ...over,
  }) as IntegrationRecord;

const haExport = (): IntegrationRecord =>
  ({
    id: 12,
    connectionId: 5,
    kind: "ha-export",
    enabled: true,
    params: { topicPrefix: "sunreye", haDiscoveryEnabled: false, haDiscoveryPrefix: "ha" },
  }) as IntegrationRecord;

describe("evccTopicRootFrom", () => {
  test("the ingest row's own root wins over the setting", () => {
    expect(evccTopicRootFrom([row({ params: { topicRoot: "garage" } })], "evcc")).toBe("garage");
  });

  test("no rows at all falls back to the setting — the upgrade has not written one yet", () => {
    expect(evccTopicRootFrom([], "from-settings")).toBe("from-settings");
  });

  test("rows of other kinds do not answer for the ingest", () => {
    expect(evccTopicRootFrom([haExport()], "from-settings")).toBe("from-settings");
  });

  test("the FIRST ingest answers when a broker carries two", () => {
    // Two EVCC instances on one broker is a supported shape the table made
    // expressible, but this build runs ONE subscription. Taking the first row is
    // the honest half-step; a client per row is the change that finishes it.
    const rows = [
      row({ params: { topicRoot: "house" } }),
      row({ id: 12, params: { topicRoot: "garage" } }),
    ];
    expect(evccTopicRootFrom(rows, "evcc")).toBe("house");
  });

  test("a DISABLED ingest row still names the root", () => {
    // `enabled` is the ingest's own off switch and `rebuildEvcc` reads it from
    // the setting; the row is still where the operator's topic root lives, and
    // ignoring it here would silently subscribe under a stale one when they
    // switch the integration back on.
    expect(
      evccTopicRootFrom([row({ enabled: false, params: { topicRoot: "garage" } })], "evcc"),
    ).toBe("garage");
  });
});

import { describe, expect, test } from "bun:test";

import {
  INTEGRATION_KINDS,
  evccIngestParamsSchema,
  haExportParamsSchema,
  integrationParamsSchema,
  parseIntegrationParams,
} from "./integrations";

describe("INTEGRATION_KINDS", () => {
  test("names exactly the two kinds the CHECK constraint admits", () => {
    // The list the constraint is RENDERED from (`./schema/plants.ts`), so a
    // third value that is only in the schema — or only here — is a row the
    // engine and the parser disagree about.
    expect([...INTEGRATION_KINDS]).toEqual(["evcc-ingest", "ha-export"]);
  });
});

describe("the evcc-ingest arm", () => {
  test("defaults the topic root to EVCC's own default", () => {
    expect(evccIngestParamsSchema.parse({})).toEqual({ topicRoot: "evcc" });
  });

  test("keeps a topic root the operator named", () => {
    expect(evccIngestParamsSchema.parse({ topicRoot: "garage" })).toEqual({ topicRoot: "garage" });
  });

  test("refuses an empty topic root and one past the length ceiling", () => {
    // Empty would subscribe to `/#` and swallow the whole broker; the ceiling is
    // the one `evcc-config.ts` has always carried.
    expect(evccIngestParamsSchema.safeParse({ topicRoot: "" }).success).toBe(false);
    expect(evccIngestParamsSchema.safeParse({ topicRoot: "x".repeat(121) }).success).toBe(false);
    expect(evccIngestParamsSchema.safeParse({ topicRoot: "x".repeat(120) }).success).toBe(true);
  });

  test("refuses a topic root that is not a string", () => {
    expect(evccIngestParamsSchema.safeParse({ topicRoot: 7 }).success).toBe(false);
    expect(evccIngestParamsSchema.safeParse({ topicRoot: null }).success).toBe(false);
  });

  test("drops a key it does not know rather than storing it", () => {
    // The params column is jsonb, so anything can be written into it. Stripping
    // is what keeps a stale field from being read back as if it meant something.
    expect(evccIngestParamsSchema.parse({ topicRoot: "evcc", brokerUrl: "mqtt://x" })).toEqual({
      topicRoot: "evcc",
    });
  });
});

describe("the ha-export arm", () => {
  test("defaults every field the integrations form leaves out", () => {
    expect(haExportParamsSchema.parse({})).toEqual({
      topicPrefix: "sunreye",
      haDiscoveryEnabled: false,
      haDiscoveryPrefix: "homeassistant",
    });
  });

  test("keeps what the operator named", () => {
    expect(
      haExportParamsSchema.parse({
        topicPrefix: "roof",
        haDiscoveryEnabled: true,
        haDiscoveryPrefix: "ha",
      }),
    ).toEqual({ topicPrefix: "roof", haDiscoveryEnabled: true, haDiscoveryPrefix: "ha" });
  });

  test("refuses an empty prefix on either topic", () => {
    // An empty prefix publishes at the broker root, where the export collides
    // with every other publisher on it.
    expect(haExportParamsSchema.safeParse({ topicPrefix: "" }).success).toBe(false);
    expect(haExportParamsSchema.safeParse({ haDiscoveryPrefix: "" }).success).toBe(false);
  });

  test("refuses a non-boolean discovery flag rather than coercing it", () => {
    // `"false"` is truthy, and coercion here would announce every entity to Home
    // Assistant on an install that asked for none.
    expect(haExportParamsSchema.safeParse({ haDiscoveryEnabled: "false" }).success).toBe(false);
    expect(haExportParamsSchema.safeParse({ haDiscoveryEnabled: 0 }).success).toBe(false);
  });

  test("drops a key it does not know", () => {
    expect(haExportParamsSchema.parse({ enabled: true, password: "s3cret" })).toEqual({
      topicPrefix: "sunreye",
      haDiscoveryEnabled: false,
      haDiscoveryPrefix: "homeassistant",
    });
  });
});

describe("parseIntegrationParams", () => {
  test("narrows on the kind and answers the parsed arm", () => {
    expect(parseIntegrationParams("evcc-ingest", {})).toEqual({
      kind: "evcc-ingest",
      params: { topicRoot: "evcc" },
    });
    expect(parseIntegrationParams("ha-export", { topicPrefix: "roof" })).toEqual({
      kind: "ha-export",
      params: {
        topicPrefix: "roof",
        haDiscoveryEnabled: false,
        haDiscoveryPrefix: "homeassistant",
      },
    });
  });

  test("accepts an EMPTY params document, which is the column default", () => {
    // `params jsonb NOT NULL DEFAULT '{}'`: a row inserted without params must
    // parse to the arm's defaults, not throw at every reader.
    for (const kind of INTEGRATION_KINDS) {
      expect(() => parseIntegrationParams(kind, {})).not.toThrow();
    }
  });

  test("THROWS on a kind this build does not know", () => {
    // Deliberately loud, exactly as `parseConnectionParams` is: a database
    // migrated ahead of this build must never be coerced into an arm it is not.
    expect(() => parseIntegrationParams("weather", {})).toThrow();
    expect(() => parseIntegrationParams("", {})).toThrow();
    expect(() => parseIntegrationParams(undefined, {})).toThrow();
    expect(() => parseIntegrationParams("HA-EXPORT", {})).toThrow();
  });

  test("THROWS on params the named kind cannot accept", () => {
    expect(() => parseIntegrationParams("evcc-ingest", { topicRoot: "" })).toThrow();
    expect(() => parseIntegrationParams("ha-export", { topicPrefix: "" })).toThrow();
    expect(() => parseIntegrationParams("ha-export", null)).toThrow();
  });
});

describe("integrationParamsSchema", () => {
  test("is a discriminated union, so the arms cannot cross", () => {
    // The union lives ONLY at this boundary: these are rows that throw, unlike
    // `app_settings`, where `readSetting` safe-parses a union arm's drift into
    // the whole document's default with no log.
    expect(integrationParamsSchema.safeParse({ kind: "evcc-ingest", params: {} }).success).toBe(
      true,
    );
    expect(integrationParamsSchema.safeParse({ kind: "nope", params: {} }).success).toBe(false);
  });
});

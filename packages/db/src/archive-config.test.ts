/**
 * `config.json`: the plant graph and the settings, BY NAME.
 *
 * Two things are proved here and neither is cosmetic.
 *
 *  1. NOT ONE INTEGER refers to a row. A device names its connection by NAME and
 *     its battery is nested inside it, because the int2 ids those rows have in
 *     the source database mean nothing in the target one — `devices.id` is
 *     `GENERATED ALWAYS`, so the target assigns its own and an id carried in the
 *     file would rebind history to the wrong device.
 *  2. THE 1.x SIDE HAS NO DEVICES TO READ. 1.2.0 stores one `app_settings` row
 *     holding a single host/port/unitId, and its `inverter_id` is the PROFILE id
 *     (`packages/inverter-core/src/driver.ts` stamped
 *     `inverterId = profile.id`). So one connection and one device are
 *     SYNTHESISED, and the synthesis has to be deterministic — the readings name
 *     the device by the slug it invents, so a slug that changed between two runs
 *     would produce a file whose readings point at nothing.
 */
import { describe, expect, test } from "bun:test";

import {
  REDACTED,
  emptyArchiveConfig,
  isSecretField,
  redactSecrets,
  parseArchiveConfig,
  slugifyId,
  synthesiseSpine,
  unwrapSetting,
} from "./archive-config";

describe("unwrapSetting", () => {
  test("an object comes back as itself", () => {
    expect(unwrapSetting({ host: "1.2.3.4", port: 502 })).toEqual({ host: "1.2.3.4", port: 502 });
  });

  test("a DOUBLE-ENCODED setting is unwrapped once", () => {
    // Real 1.x databases exist whose jsonb column holds a JSON *string* that
    // itself contains the document (the committed 1.2.0 fixture is one). A reader
    // that did not unwrap would see a string where it expected a host and
    // synthesise a device pointing nowhere.
    expect(unwrapSetting(JSON.stringify({ host: "1.2.3.4" }))).toEqual({ host: "1.2.3.4" });
  });

  test("a plain string that is not JSON stays the string", () => {
    expect(unwrapSetting("deye-sg05lp3")).toBe("deye-sg05lp3");
  });

  test("a double-encoded plain string is unwrapped to the string", () => {
    expect(unwrapSetting('"deye-sg05lp3"')).toBe("deye-sg05lp3");
  });

  test("null and undefined stay themselves rather than becoming {}", () => {
    expect(unwrapSetting(null)).toBeNull();
    expect(unwrapSetting(undefined)).toBeUndefined();
  });

  test("a number stays a number", () => {
    expect(unwrapSetting(502)).toBe(502);
  });
});

describe("slugifyId", () => {
  test("a profile id is already a slug and is left alone", () => {
    expect(slugifyId("deye-sg05lp3")).toBe("deye-sg05lp3");
  });

  test("upper case, spaces and punctuation collapse to a bare slug", () => {
    expect(slugifyId("Victron GX (Main)")).toBe("victron-gx-main");
  });

  test("leading and trailing separators are trimmed", () => {
    expect(slugifyId("--weird--")).toBe("weird");
  });

  test("an id that slugifies to nothing gets a stable fallback, never an empty slug", () => {
    // An empty slug would violate the devices unique key and, worse, make the
    // readings' device_slug unmatchable.
    expect(slugifyId("///")).toBe("device");
    expect(slugifyId("")).toBe("device");
  });

  test("it is deterministic — the readings depend on it", () => {
    expect(slugifyId("Deye SG05LP3")).toBe(slugifyId("Deye SG05LP3"));
  });
});

describe("synthesiseSpine — the 1.x path", () => {
  const settings = new Map<string, unknown>([
    [
      "inverter",
      {
        host: "192.168.1.50",
        port: 502,
        unitId: 1,
        transport: "tcp",
        timeoutMs: 2000,
        pollIntervalMs: 1000,
      },
    ],
    ["plant", { timeZone: "Europe/Berlin" }],
  ]);

  test("one connection and one device, from the one settings row", () => {
    const plant = synthesiseSpine({ settings, profileId: "deye-sg05lp3" });
    expect(plant.connections).toHaveLength(1);
    expect(plant.devices).toHaveLength(1);
    const [connection] = plant.connections;
    expect(connection).toMatchObject({ host: "192.168.1.50", port: 502, transport: "tcp" });
    const [device] = plant.devices;
    expect(device).toMatchObject({
      slug: "deye-sg05lp3",
      profileId: "deye-sg05lp3",
      role: "inverter",
      unitId: 1,
      connection: connection?.name,
    });
  });

  test("the device slug is the profile id, because that is what the readings name", () => {
    // 1.2.0's `inverter_id` IS the profile id, so this is the one choice that
    // makes the readings' device_slug resolve without a mapping table.
    expect(synthesiseSpine({ settings, profileId: "sigen-ess" }).devices[0]?.slug).toBe(
      "sigen-ess",
    );
  });

  test("the plant time zone is carried, and 'auto' is a legitimate value", () => {
    expect(synthesiseSpine({ settings, profileId: "x" }).timeZone).toBe("Europe/Berlin");
    expect(synthesiseSpine({ settings: new Map(), profileId: "x" }).timeZone).toBe("auto");
  });

  test("the FIXTURE'S key naming is read too — inverter.connection / inverter.profile", () => {
    const legacy = new Map<string, unknown>([
      ["inverter.connection", JSON.stringify({ host: "10.0.0.9", port: 8899, unitId: 3 })],
      ["inverter.profile", '"deye-sg05lp3"'],
      ["plant", JSON.stringify({ timeZone: "Europe/Berlin" })],
    ]);
    const plant = synthesiseSpine({ legacy: true, settings: legacy, profileId: null });
    expect(plant.connections[0]).toMatchObject({ host: "10.0.0.9", port: 8899 });
    expect(plant.devices[0]).toMatchObject({ slug: "deye-sg05lp3", unitId: 3 });
  });

  test("an explicit profileId always wins over the settings row", () => {
    const legacy = new Map<string, unknown>([["inverter.profile", '"from-settings"']]);
    expect(synthesiseSpine({ settings: legacy, profileId: "explicit" }).devices[0]?.slug).toBe(
      "explicit",
    );
  });

  test("NO HOST AT ALL still yields a device — an imported history's hardware may be gone", () => {
    // The device is what the readings resolve against; refusing to synthesise one
    // because there is no reachable inverter would make the history unimportable.
    const plant = synthesiseSpine({ settings: new Map(), profileId: "orphan" });
    expect(plant.connections).toEqual([]);
    expect(plant.devices[0]).toMatchObject({ slug: "orphan", connection: null, unitId: 0 });
  });

  test("no profile id anywhere is a refusal, not a device called 'undefined'", () => {
    expect(() => synthesiseSpine({ settings: new Map(), profileId: null })).toThrow(/profile id/);
  });

  test("a nonsense port or unitId falls back to the schema default rather than being carried", () => {
    const odd = new Map<string, unknown>([
      ["inverter", { host: "h", port: "not a port", unitId: null }],
    ]);
    const plant = synthesiseSpine({ settings: odd, profileId: "p" });
    expect(plant.connections[0]?.port).toBe(502);
    expect(plant.devices[0]?.unitId).toBe(0);
  });

  test("the synthesised plant carries no ids at all", () => {
    const json = JSON.stringify(synthesiseSpine({ settings, profileId: "p" }));
    expect(json).not.toMatch(/"id"\s*:/);
    expect(json).not.toMatch(/"plantId"|"connectionId"|"deviceId"/);
  });
});

describe("parseArchiveConfig", () => {
  test("an empty config is valid and yields empty everything", () => {
    const config = parseArchiveConfig(emptyArchiveConfig());
    expect(config.plant).toBeNull();
    expect(config.appSettings).toEqual([]);
    expect(config.metricKeys).toEqual([]);
    expect(config.configKeys).toEqual([]);
  });

  test("null or a non-object is an empty config rather than a crash", () => {
    for (const input of [null, undefined, 7, "x", []]) {
      expect(parseArchiveConfig(input).appSettings).toEqual([]);
    }
  });

  test("a full config round-trips through JSON", () => {
    const config = {
      ...emptyArchiveConfig(),
      plant: synthesiseSpine({
        settings: new Map<string, unknown>([["inverter", { host: "h", port: 502, unitId: 1 }]]),
        profileId: "p",
      }),
      appSettings: [{ key: "tariff", value: { kind: "fixed" } }],
      installedProfiles: [{ id: "p", source: "repo", version: "1.0.0", data: { id: "p" } }],
      customCharts: [{ id: "c", name: "Chart", data: { series: [] } }],
      metricKeys: [{ key: "total_energy", isCounter: true }],
      configKeys: ["settings.limit"],
    };
    expect(parseArchiveConfig(JSON.parse(JSON.stringify(config)))).toEqual(config);
  });

  test("a metric key with a missing isCounter defaults to false, the value that cannot corrupt a delta", () => {
    const parsed = parseArchiveConfig({ metricKeys: [{ key: "k" }] });
    expect(parsed.metricKeys).toEqual([{ key: "k", isCounter: false }]);
  });

  test("garbage entries in a list are dropped rather than poisoning the import", () => {
    const parsed = parseArchiveConfig({
      appSettings: [{ key: "ok", value: 1 }, { value: 2 }, null, "x"],
      customCharts: [{ id: "c", name: "n", data: {} }, { id: "no-name" }],
      configKeys: ["a", 7, null],
    });
    expect(parsed.appSettings).toEqual([{ key: "ok", value: 1 }]);
    expect(parsed.customCharts).toHaveLength(1);
    expect(parsed.configKeys).toEqual(["a"]);
  });

  test("a setting whose value is FALSE or 0 survives — those are values, not absences", () => {
    const parsed = parseArchiveConfig({
      appSettings: [
        { key: "a", value: false },
        { key: "b", value: 0 },
        { key: "c", value: null },
      ],
    });
    expect(parsed.appSettings).toEqual([
      { key: "a", value: false },
      { key: "b", value: 0 },
      { key: "c", value: null },
    ]);
  });

  test("a retired device stays retired across a parse — it must not come back pollable", () => {
    const parsed = parseArchiveConfig({
      plant: {
        name: "P",
        slug: "p",
        timeZone: "auto",
        devices: [
          {
            slug: "old",
            name: "Old",
            profileId: "x",
            role: "inverter",
            unitId: 1,
            connection: null,
            retiredAt: "2026-03-04T05:06:07.000Z",
          },
        ],
      },
    });
    expect(parsed.plant?.devices[0]?.retiredAt).toBe("2026-03-04T05:06:07.000Z");
  });

  test("a device from an archive written before retirement existed parses as in service", () => {
    const parsed = parseArchiveConfig({
      plant: {
        name: "P",
        slug: "p",
        timeZone: "auto",
        devices: [
          { slug: "d", name: "D", profileId: "x", role: "inverter", unitId: 1, connection: null },
        ],
      },
    });
    expect(parsed.plant?.devices[0]?.retiredAt).toBeNull();
  });

  test("a retiredAt that is not a string is dropped rather than trusted", () => {
    const parsed = parseArchiveConfig({
      plant: {
        name: "P",
        slug: "p",
        timeZone: "auto",
        devices: [
          {
            slug: "d",
            name: "D",
            profileId: "x",
            role: "inverter",
            unitId: 1,
            connection: null,
            retiredAt: 1772668800000,
          },
        ],
      },
    });
    expect(parsed.plant?.devices[0]?.retiredAt).toBeNull();
  });

  test("a device naming a connection that the file does not carry is reported", () => {
    const parsed = parseArchiveConfig({
      plant: {
        name: "P",
        slug: "p",
        timeZone: "auto",
        connections: [{ name: "A", host: "h" }],
        devices: [
          {
            slug: "d",
            name: "D",
            profileId: "x",
            role: "inverter",
            unitId: 1,
            connection: "GHOST",
          },
        ],
      },
    });
    expect(parsed.problems).toContain(
      'device "d" names connection "GHOST", which the archive does not carry',
    );
  });
});

describe("redactSecrets", () => {
  test("the MQTT password — which the REST API itself refuses to return — is redacted", () => {
    expect(redactSecrets({ url: "mqtt://h:1883", username: "mqtt", password: "hunter2" })).toEqual({
      url: "mqtt://h:1883",
      username: "mqtt",
      password: REDACTED,
    });
  });

  test("a provider token is redacted", () => {
    expect(redactSecrets({ provider: "entso-e", token: "abc" })).toEqual({
      provider: "entso-e",
      token: REDACTED,
    });
  });

  test("REPLACED, not deleted — an absent key reads as 'never set'", () => {
    // Which is indistinguishable from "it did not travel", and leaves the operator
    // with no idea which field to retype.
    const out = redactSecrets({ password: "x" }) as Record<string, unknown>;
    expect("password" in out).toBe(true);
    expect(out.password).toBe(REDACTED);
  });

  test("matched by FIELD NAME, so a field this build has never heard of is covered", () => {
    // A per-key allow-list is a snapshot of today's schema and stops applying the
    // moment a new provider adds a credential.
    for (const name of [
      "apiKey",
      "api_key",
      "clientSecret",
      "refreshToken",
      "PASSWORD",
      "privateKey",
    ]) {
      expect(isSecretField(name)).toBe(true);
    }
  });

  test("ordinary fields are not redacted", () => {
    for (const name of ["host", "port", "zone", "provider", "timeZone", "importCentsPerKwh"]) {
      expect(isSecretField(name)).toBe(false);
    }
    // THE FORMAT'S OWN FIELDS. `tariffKey` and `metricKey` end in "Key" and are
    // not secrets; redacting either would break the archive rather than protect
    // anything, so the pattern must require the `api`/`private` prefix.
    for (const name of ["tariffKey", "metricKey", "deviceKey", "key"]) {
      expect(isSecretField(name)).toBe(false);
    }
  });

  test("nested and array-nested secrets are reached", () => {
    expect(
      redactSecrets({ brokers: [{ host: "a", password: "p" }], inner: { deep: { token: "t" } } }),
    ).toEqual({
      brokers: [{ host: "a", password: REDACTED }],
      inner: { deep: { token: REDACTED } },
    });
  });

  test("a secret whose VALUE is an object is still redacted whole", () => {
    // Otherwise a nested credential bag smuggles itself through under a safe-looking
    // shape.
    expect(redactSecrets({ credentials: { user: "u", pass: "p" } })).toEqual({
      credentials: REDACTED,
    });
  });

  test("primitives, null and undefined pass through unchanged", () => {
    expect(redactSecrets(7)).toBe(7);
    expect(redactSecrets("host")).toBe("host");
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets(false)).toBe(false);
  });

  test("it does not mutate its input — the caller still holds the real settings", () => {
    const original = { password: "hunter2", host: "h" };
    redactSecrets(original);
    expect(original.password).toBe("hunter2");
  });

  test("a zero or false value under a safe name survives", () => {
    expect(redactSecrets({ port: 0, enabled: false })).toEqual({ port: 0, enabled: false });
  });
});

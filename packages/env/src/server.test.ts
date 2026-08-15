import "dotenv/config";
import { describe, expect, test } from "bun:test";

/**
 * The schema is validated at *import time* against `process.env`, and the whole
 * suite runs with `SKIP_ENV_VALIDATION=1` — so a plain `import { env }` here
 * would exercise nothing at all. Each case therefore re-imports the module with
 * a fresh specifier (the `?case=` suffix defeats the module cache) against an
 * env it controls, then restores `process.env` exactly as it found it. Nothing
 * is mocked: this is the real schema doing the real validation.
 *
 * `dotenv/config` is imported once, above, so a repo `.env` can never sneak a
 * variable back in *after* a case has deliberately removed it.
 */

/** Every key the server schema reads, plus the skip flag. */
const SCHEMA_KEYS = [
  "SKIP_ENV_VALIDATION",
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "CORS_ORIGIN",
  "TRUSTED_ORIGINS",
  "AUTH_SECURE_COOKIES",
  "NODE_ENV",
  "PORT",
  "HOST",
  "LOG_LEVEL",
  "LOG_LEVEL_MQTT",
  "INVERTER_PROFILE",
  "INVERTER_HOST",
  "INVERTER_PORT",
  "INVERTER_UNIT_ID",
  "INVERTER_TRANSPORT",
  "POLL_INTERVAL_MS",
  "HISTORY_FLUSH_INTERVAL_MS",
  "INVERTER_SIMULATE",
  "API_KEYS",
  "MQTT_ENABLED",
  "MQTT_BROKER_URL",
  "MQTT_TOPIC_PREFIX",
  "MQTT_USERNAME",
  "MQTT_PASSWORD",
  "HA_DISCOVERY_ENABLED",
  "HA_DISCOVERY_PREFIX",
] as const;

type ServerEnv = typeof import("./server").env;
type RawEnv = Record<string, unknown>;

/** The two vars with no default — every valid case needs them. */
const REQUIRED = {
  DATABASE_URL: "postgres://sunreye:pw@localhost:5432/sunreye",
  BETTER_AUTH_SECRET: "s".repeat(32),
};

let generation = 0;

/**
 * Import the schema against exactly `vars` (validation on unless `skip` is
 * given), then put `process.env` back — module env is process-global, and this
 * file must leave none of it behind for the suites that run after it.
 */
async function loadEnv(
  vars: Record<string, string>,
  skip?: string,
  /** Runs while the case's env is still installed — the only way to read a
   *  skipped env, which is `process.env` itself rather than a parsed copy. */
  inspect?: (env: RawEnv) => void,
): Promise<RawEnv> {
  const snapshot = new Map(SCHEMA_KEYS.map((k) => [k, process.env[k]] as const));
  for (const k of SCHEMA_KEYS) delete process.env[k];
  if (skip !== undefined) process.env.SKIP_ENV_VALIDATION = skip;
  Object.assign(process.env, vars);
  // The schema logs the whole issue list before throwing; keep the failing
  // cases from drowning the test output.
  const realError = console.error;
  console.error = () => {};
  try {
    const mod = (await import(`./server.ts?case=${++generation}`)) as { env: RawEnv };
    inspect?.(mod.env);
    return mod.env;
  } finally {
    console.error = realError;
    for (const [k, v] of snapshot) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** A validated env built from `REQUIRED` plus the overrides under test. */
const validated = async (vars: Record<string, string> = {}): Promise<ServerEnv> =>
  (await loadEnv({ ...REQUIRED, ...vars })) as unknown as ServerEnv;

/** Assert the schema refuses to boot with these vars. */
const rejects = (vars: Record<string, string>) =>
  expect(loadEnv({ ...REQUIRED, ...vars })).rejects.toThrow("Invalid environment variables");

describe("booting with the bare minimum", () => {
  test("a database URL and a signing secret are enough — the rest defaults", async () => {
    const env = await validated();

    expect(env.PORT).toBe(3000);
    expect(env.HOST).toBe("0.0.0.0");
    expect(env.NODE_ENV).toBe("development");
    expect(env.BETTER_AUTH_URL).toBe("http://localhost:3000");
    expect(env.POLL_INTERVAL_MS).toBe(1000);
    expect(env.HISTORY_FLUSH_INTERVAL_MS).toBe(5000);
    expect(env.MQTT_BROKER_URL).toBe("mqtt://localhost:1883");
    expect(env.MQTT_TOPIC_PREFIX).toBe("sunreye");
    expect(env.HA_DISCOVERY_PREFIX).toBe("homeassistant");
  });

  test("every opt-in feature is off and every origin list empty by default", async () => {
    const env = await validated();

    // Same-origin, no CORS, no broker dialled, no third-party API access.
    expect(env.CORS_ORIGIN).toBeUndefined();
    expect(env.TRUSTED_ORIGINS).toEqual([]);
    expect(env.API_KEYS).toEqual([]);
    expect(env.AUTH_SECURE_COOKIES).toBe(false);
    expect(env.MQTT_ENABLED).toBe(false);
    expect(env.HA_DISCOVERY_ENABLED).toBe(false);
    expect(env.INVERTER_SIMULATE).toBe(false);
  });

  test("the inverter connection stays unset so the UI can own it", async () => {
    const env = await validated();

    expect(env.INVERTER_PROFILE).toBeUndefined();
    expect(env.INVERTER_HOST).toBeUndefined();
    expect(env.INVERTER_PORT).toBeUndefined();
    expect(env.INVERTER_UNIT_ID).toBeUndefined();
    expect(env.INVERTER_TRANSPORT).toBeUndefined();
    expect(env.LOG_LEVEL).toBeUndefined();
    expect(env.LOG_LEVEL_MQTT).toBeUndefined();
  });

  test("a missing database URL stops the boot instead of starting half-configured", async () => {
    await expect(loadEnv({ BETTER_AUTH_SECRET: REQUIRED.BETTER_AUTH_SECRET })).rejects.toThrow(
      "Invalid environment variables",
    );
  });

  test("an empty string is an unset variable, not a value", async () => {
    // `emptyStringAsUndefined`: a compose file that leaves `DATABASE_URL=` in
    // place must fail like an absent one, not connect to "".
    await expect(loadEnv({ ...REQUIRED, DATABASE_URL: "" })).rejects.toThrow(
      "Invalid environment variables",
    );
    // And an emptied optional simply falls back to its default.
    const env = await validated({ CORS_ORIGIN: "", MQTT_TOPIC_PREFIX: "" });
    expect(env.CORS_ORIGIN).toBeUndefined();
    expect(env.MQTT_TOPIC_PREFIX).toBe("sunreye");
  });
});

describe("the auth signing secret", () => {
  test("must be at least 32 characters", async () => {
    await rejects({ BETTER_AUTH_SECRET: "x".repeat(31) });
    expect(
      (await validated({ BETTER_AUTH_SECRET: "x".repeat(32) })).BETTER_AUTH_SECRET,
    ).toHaveLength(32);
  });
});

describe("origins the browser and Better Auth are told to trust", () => {
  test("a comma-separated list is trimmed into individual origins", async () => {
    const env = await validated({
      TRUSTED_ORIGINS: " https://ha.example , https://lan.example:8123 ",
    });

    expect(env.TRUSTED_ORIGINS).toEqual(["https://ha.example", "https://lan.example:8123"]);
  });

  test("stray and trailing commas never become an empty trusted origin", async () => {
    // An empty string in this list would match nothing at best and widen the
    // CSRF check at worst, so it must be dropped, not kept.
    expect((await validated({ TRUSTED_ORIGINS: "https://a.example,, ," })).TRUSTED_ORIGINS).toEqual(
      ["https://a.example"],
    );
    expect((await validated({ TRUSTED_ORIGINS: " , " })).TRUSTED_ORIGINS).toEqual([]);
  });

  test("a single origin with no comma is still a list", async () => {
    expect((await validated({ TRUSTED_ORIGINS: "https://only.example" })).TRUSTED_ORIGINS).toEqual([
      "https://only.example",
    ]);
  });

  test("a split-origin deployment's CORS origin must be a URL", async () => {
    expect((await validated({ CORS_ORIGIN: "http://localhost:3001" })).CORS_ORIGIN).toBe(
      "http://localhost:3001",
    );
    // A bare host is not a URL and could never match a browser Origin header.
    await rejects({ CORS_ORIGIN: "web.example.com" });
  });

  test("a scheme-less host:port slips through as a URL — it is parsed, not validated as http(s)", async () => {
    // `z.url()` accepts `localhost:3001` by reading `localhost:` as the scheme.
    // Pinned deliberately: the value boots but never matches a real Origin, so
    // this is the shape a user's "CORS doesn't work" report will have.
    expect((await validated({ CORS_ORIGIN: "localhost:3001" })).CORS_ORIGIN).toBe("localhost:3001");
  });

  test("a malformed advertised auth URL is refused rather than defaulted away", async () => {
    await rejects({ BETTER_AUTH_URL: "not-a-url" });
  });
});

describe("API keys for the integration API", () => {
  test("are trimmed, de-blanked and kept in order", async () => {
    expect((await validated({ API_KEYS: " k-one , k-two ,, " })).API_KEYS).toEqual([
      "k-one",
      "k-two",
    ]);
  });

  test("an unset or blank list is empty — never a list containing an empty key", async () => {
    // An empty-string key would authorize every request that sends no key.
    expect((await validated({ API_KEYS: "" })).API_KEYS).toEqual([]);
    expect((await validated({ API_KEYS: ",,," })).API_KEYS).toEqual([]);
  });
});

describe("boolean-shaped flags", () => {
  test("only the exact strings true and false are accepted", async () => {
    expect((await validated({ AUTH_SECURE_COOKIES: "true" })).AUTH_SECURE_COOKIES).toBe(true);
    expect((await validated({ AUTH_SECURE_COOKIES: "false" })).AUTH_SECURE_COOKIES).toBe(false);
    // A typo must not silently read as "off" for a security flag.
    await rejects({ AUTH_SECURE_COOKIES: "TRUE" });
    await rejects({ AUTH_SECURE_COOKIES: "1" });
    await rejects({ AUTH_SECURE_COOKIES: "yes" });
  });

  test("simulation, MQTT and HA discovery each toggle independently", async () => {
    const env = await validated({
      INVERTER_SIMULATE: "true",
      MQTT_ENABLED: "true",
      HA_DISCOVERY_ENABLED: "true",
    });

    expect(env.INVERTER_SIMULATE).toBe(true);
    expect(env.MQTT_ENABLED).toBe(true);
    expect(env.HA_DISCOVERY_ENABLED).toBe(true);
  });

  test("HA discovery can be asked for without MQTT — the server enforces the pairing", async () => {
    // Documents the seam: the schema is per-variable, so the "requires
    // MQTT_ENABLED" rule lives in the server, not here.
    const env = await validated({ HA_DISCOVERY_ENABLED: "true" });

    expect(env.HA_DISCOVERY_ENABLED).toBe(true);
    expect(env.MQTT_ENABLED).toBe(false);
  });
});

describe("numeric settings", () => {
  test("arrive as numbers, not strings", async () => {
    const env = await validated({ PORT: "8080", INVERTER_PORT: "8899" });

    expect(env.PORT).toBe(8080);
    expect(env.INVERTER_PORT).toBe(8899);
  });

  test("a port must be a positive whole number", async () => {
    await rejects({ PORT: "0" });
    await rejects({ PORT: "-1" });
    await rejects({ PORT: "8080.5" });
    await rejects({ PORT: "http" });
  });

  test("unit id 0 is a real Modbus slave id, not an unset value", async () => {
    expect((await validated({ INVERTER_UNIT_ID: "0" })).INVERTER_UNIT_ID).toBe(0);
    await rejects({ INVERTER_UNIT_ID: "-1" });
  });

  test("the poll interval cannot be zero or negative", async () => {
    expect((await validated({ POLL_INTERVAL_MS: "2000" })).POLL_INTERVAL_MS).toBe(2000);
    await rejects({ POLL_INTERVAL_MS: "0" });
    await rejects({ POLL_INTERVAL_MS: "-1000" });
  });

  test("a history flush window at or below the poll interval is legal — it disables batching", async () => {
    const env = await validated({ POLL_INTERVAL_MS: "1000", HISTORY_FLUSH_INTERVAL_MS: "1000" });

    expect(env.HISTORY_FLUSH_INTERVAL_MS).toBe(1000);
    await rejects({ HISTORY_FLUSH_INTERVAL_MS: "0" });
  });
});

describe("the inverter address", () => {
  test("accepts an IPv4 or IPv6 literal", async () => {
    expect((await validated({ INVERTER_HOST: "192.168.1.40" })).INVERTER_HOST).toBe("192.168.1.40");
    expect((await validated({ INVERTER_HOST: "fd00::1" })).INVERTER_HOST).toBe("fd00::1");
  });

  test("refuses anything that is not an IP literal", async () => {
    // NOTE: this also rejects DNS names (`deye.lan`), which the DB-backed
    // config does accept — see the finding in the suite's report.
    await rejects({ INVERTER_HOST: "deye.lan" });
    await rejects({ INVERTER_HOST: "999.1.1.1" });
  });

  test("the framing is one of the two supported transports", async () => {
    expect((await validated({ INVERTER_TRANSPORT: "rtu-over-tcp" })).INVERTER_TRANSPORT).toBe(
      "rtu-over-tcp",
    );
    expect((await validated({ INVERTER_TRANSPORT: "tcp" })).INVERTER_TRANSPORT).toBe("tcp");
    await rejects({ INVERTER_TRANSPORT: "serial" });
  });
});

describe("log levels", () => {
  test("accept LogTape's severities, including the MQTT-only override", async () => {
    const env = await validated({ LOG_LEVEL: "warning", LOG_LEVEL_MQTT: "debug" });

    expect(env.LOG_LEVEL).toBe("warning");
    expect(env.LOG_LEVEL_MQTT).toBe("debug");
  });

  test("reject a near-miss spelling instead of silently falling back", async () => {
    await rejects({ LOG_LEVEL: "warn" });
    await rejects({ LOG_LEVEL_MQTT: "verbose" });
  });
});

describe("NODE_ENV", () => {
  test("is one of the three known modes", async () => {
    expect((await validated({ NODE_ENV: "production" })).NODE_ENV).toBe("production");
    expect((await validated({ NODE_ENV: "test" })).NODE_ENV).toBe("test");
    await rejects({ NODE_ENV: "staging" });
  });
});

describe("SKIP_ENV_VALIDATION", () => {
  test("hands the raw process env through, applying neither validation nor defaults", async () => {
    // How the whole test suite boots. Nothing is coerced (PORT stays the string
    // it was), no default materializes, and the required vars are not even
    // checked — so code under test must never rely on a default while the flag
    // is set.
    const seen: RawEnv = {};
    await loadEnv({ PORT: "8080" }, "1", (env) => {
      Object.assign(seen, {
        PORT: env.PORT,
        DATABASE_URL: env.DATABASE_URL,
        TRUSTED_ORIGINS: env.TRUSTED_ORIGINS,
        API_KEYS: env.API_KEYS,
        MQTT_TOPIC_PREFIX: env.MQTT_TOPIC_PREFIX,
      });
    });

    expect(seen.PORT).toBe("8080");
    expect(seen.DATABASE_URL).toBeUndefined();
    // The comma-splitting transforms never ran, so these are not arrays.
    expect(seen.TRUSTED_ORIGINS).toBeUndefined();
    expect(seen.API_KEYS).toBeUndefined();
    expect(seen.MQTT_TOPIC_PREFIX).toBeUndefined();
  });

  test("the skipped env is process.env itself, not a parsed copy", async () => {
    // Worth pinning: a later mutation of process.env is visible through `env`
    // in this mode and invisible in the validated one.
    await loadEnv({}, "1", (env) => {
      expect(env).toBe(process.env as unknown as RawEnv);
    });
  });

  test('any non-empty value skips — even "false" and "0"', async () => {
    // The guard is `!!process.env.SKIP_ENV_VALIDATION`, so writing
    // `SKIP_ENV_VALIDATION=false` to *enable* validation does the opposite.
    // "it resolved" is too weak a reading of that: assert the skip actually
    // happened the way the mode is identified everywhere else — the raw
    // `process.env` is handed through, unvalidated and undefaulted, even though
    // this env is missing every required variable.
    for (const flag of ["false", "0"]) {
      await loadEnv({}, flag, (env) => {
        expect(env).toBe(process.env as unknown as RawEnv);
        expect(env.DATABASE_URL).toBeUndefined();
      });
    }
  });

  test("an empty flag means validation is on", async () => {
    await expect(loadEnv({}, "")).rejects.toThrow("Invalid environment variables");
  });
});

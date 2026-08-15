/**
 * The server's LogTape wiring: what reaches the admin log viewer, what is
 * filtered out, and how a log line is rendered on the way there.
 *
 * Nothing here is mocked. `setupLogging()` configures LogTape for real and the
 * assertions are made on the records that come out the other end of the real
 * sinks — that is the only way to prove the parts that are pure configuration
 * (the per-category filters, `parentSinks: "override"`, the `lowestLevel` on
 * LogTape's own meta category), which a stubbed sink would assert nothing
 * about.
 *
 * Two mechanics are worth reading before the tests:
 *
 * 1. The console sink is real too, so the console methods it looks up are
 *    replaced with no-ops for the length of the file (and restored after).
 *    Without that, the ring-buffer test alone prints several hundred lines
 *    into the runner's output.
 *
 * 2. Records are collected through {@link emitted}, which reads them off a
 *    `logs` subscription on the injected stream rather than off `recentLogs()`.
 *    The ring buffer is capped and module-global: once the eviction test has
 *    filled it, a "length before/length after" diff would silently observe
 *    nothing. A subscriber is handed the very same entry object the buffer
 *    receives, so it is the stable seam. The buffer's own behaviour is asserted
 *    directly.
 *
 * Boot-time configuration (`LOG_LEVEL`, `LOG_LEVEL_MQTT`, `NODE_ENV`) is read
 * once at module load, so those cases run a fresh `bun` process per
 * environment instead of mutating a global mock.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { LogEntry } from "@SunReye/contracts/logs";
import { configure, getLogger, type LogLevel } from "@logtape/logtape";
import {
  applyLogLevel,
  currentLogLevel,
  defaultLogLevel,
  log,
  recentLogs,
  setupLogging,
} from "./logging";
import { createStreams } from "./streams";

const realConsole = {
  debug: console.debug,
  info: console.info,
  warn: console.warn,
  error: console.error,
};

/**
 * The bus the sink emits log lines onto. Injected once at setup; the tests
 * subscribe to its `logs` topic to observe what made it past the filters.
 */
const streams = createStreams();

beforeAll(async () => {
  for (const method of ["debug", "info", "warn", "error"] as const) {
    console[method] = () => {};
  }
  await setupLogging(streams);
});

afterAll(async () => {
  // LogTape's configuration is process-global, and so is bun's test run: left
  // configured, every suite that happens to run after this one would print its
  // own logs into the runner's output. Put the process back the way it was.
  await configure({ reset: true, sinks: {}, loggers: [] });
  Object.assign(console, realConsole);
});

afterEach(() => {
  applyLogLevel(null);
});

/** The lines that made it past the filters into the sink while `emit` ran. */
function emitted(emit: () => void): LogEntry[] {
  const seen: LogEntry[] = [];
  const unsubscribe = streams.subscribe("logs", (entry) => seen.push(entry));
  try {
    emit();
  } finally {
    unsubscribe();
  }
  return seen;
}

/** The single line `emit` produced (fails loudly if it produced anything else). */
function onlyLine(emit: () => void): LogEntry {
  const lines = emitted(emit);
  expect(lines).toHaveLength(1);
  return lines[0] as LogEntry;
}

/** Render one interpolated value the way a caller would log it. */
function rendered(value: unknown): string {
  return onlyLine(() => log("render").info("value={value}", { value })).message;
}

const ALL_LEVELS: LogLevel[] = ["trace", "debug", "info", "warning", "error", "fatal"];

describe("app log categories", () => {
  test("a subcategory hangs off the shared server root", () => {
    applyLogLevel("trace");
    expect(onlyLine(() => log("mqtt").info("connected")).category).toBe("server.mqtt");
  });

  test("a nested subcategory keeps its whole dotted path", () => {
    applyLogLevel("trace");
    expect(onlyLine(() => log("automation", "peak-shaving").info("tick")).category).toBe(
      "server.automation.peak-shaving",
    );
  });

  test("the root itself is loggable without a subcategory", () => {
    applyLogLevel("trace");
    expect(onlyLine(() => log().info("booting")).category).toBe("server");
  });

  test("HTTP request lines ride the same sinks as the app logs", () => {
    applyLogLevel("trace");
    // Elysia's request logger is mounted as ["server", "http"] precisely so it
    // inherits the root logger's sinks and runtime floor.
    const line = onlyLine(() => getLogger(["server", "http"]).info("GET /api/status 200"));
    expect(line.category).toBe("server.http");
    expect(line.message).toBe("GET /api/status 200");
  });

  test("HTTP request lines obey the runtime floor like everything else", () => {
    applyLogLevel("warning");
    expect(emitted(() => getLogger(["server", "http"]).info("GET /api/status 200"))).toEqual([]);
  });

  test("the engine library's own logs reach the viewer", () => {
    applyLogLevel("trace");
    const line = onlyLine(() => getLogger(["inverter-core", "driver"]).debug("read plan rebuilt"));
    expect(line.category).toBe("inverter-core.driver");
  });

  test("a category outside the configured trees never reaches the viewer", () => {
    applyLogLevel("trace");
    // The default ["elysia"] category the request logger would use if the
    // category remap in index.ts were ever dropped: no sinks, no viewer.
    expect(emitted(() => getLogger(["elysia"]).info("GET / 200"))).toEqual([]);
  });
});

describe("the runtime severity floor", () => {
  test("the effective level starts at the boot default, and that default is a real floor", () => {
    // Asserting `currentLogLevel()` against `defaultLogLevel()` proves nothing:
    // `afterEach` calls `applyLogLevel(null)`, which assigns one from the other,
    // so the comparison holds however the default is derived — it survived the
    // whole derivation being replaced by a literal. Name the level instead.
    // `bun test` runs with NODE_ENV=test and no LOG_LEVEL, so the boot default
    // is the quiet branch.
    expect(defaultLogLevel()).toBe("info");
    expect(currentLogLevel()).toBe("info");

    // And it governs the sinks rather than merely being reported: at the boot
    // default an info line reaches the viewer and a debug line is dropped.
    const logger = log("boot-default");
    expect(emitted(() => logger.info("kept")).map((l) => l.message)).toEqual(["kept"]);
    expect(emitted(() => logger.debug("dropped"))).toEqual([]);
  });

  test("every level from trace to fatal reaches the viewer at the lowest floor", () => {
    applyLogLevel("trace");
    const logger = log("levels");
    const lines = emitted(() => {
      logger.trace("t");
      logger.debug("d");
      logger.info("i");
      logger.warn("w");
      logger.error("e");
      logger.fatal("f");
    });
    expect(lines.map((l) => l.level)).toEqual(ALL_LEVELS);
  });

  test("records below the floor are dropped and the floor itself is kept", () => {
    applyLogLevel("warning");
    const logger = log("levels");
    const lines = emitted(() => {
      logger.trace("t");
      logger.debug("d");
      logger.info("i");
      logger.warn("w");
      logger.error("e");
      logger.fatal("f");
    });
    expect(lines.map((l) => l.level)).toEqual(["warning", "error", "fatal"]);
  });

  test("only a fatal survives the highest floor", () => {
    applyLogLevel("fatal");
    const logger = log("levels");
    const lines = emitted(() => {
      logger.error("inverter unreachable");
      logger.fatal("engine stopped");
    });
    expect(lines.map((l) => l.message)).toEqual(["engine stopped"]);
  });

  test("a level change takes effect on the very next record, without reconfiguring", () => {
    const logger = log("levels");
    const lines = emitted(() => {
      applyLogLevel("error");
      logger.info("before");
      applyLogLevel("trace");
      logger.info("after");
    });
    expect(lines.map((l) => l.message)).toEqual(["after"]);
  });

  test("clearing the level returns to the boot default", () => {
    applyLogLevel("fatal");
    expect(currentLogLevel()).toBe("fatal");
    applyLogLevel(null);
    expect(currentLogLevel()).toBe(defaultLogLevel());
  });

  test("the boot default is never moved by a runtime change", () => {
    const boot = defaultLogLevel();
    applyLogLevel(boot === "trace" ? "fatal" : "trace");
    expect(defaultLogLevel()).toBe(boot);
  });
});

describe("the MQTT category", () => {
  test("an MQTT line is buffered once, not once per inherited sink", () => {
    applyLogLevel("trace");
    // `parentSinks: "override"` detaches the mqtt logger from the root's
    // sinks. Without it the record hits console+stream twice and the viewer
    // shows every MQTT line doubled.
    const line = onlyLine(() => log("mqtt").info("publish sunreye/deye/pv_power"));
    expect(line.category).toBe("server.mqtt");
  });

  test("MQTT follows the runtime floor when it has no env override of its own", () => {
    applyLogLevel("error");
    const logger = log("mqtt");
    const lines = emitted(() => {
      logger.info("connected");
      logger.error("subscribe failed");
    });
    expect(lines.map((l) => l.message)).toEqual(["subscribe failed"]);
  });

  test("a deeper MQTT subcategory rides the MQTT logger, not the root's", () => {
    applyLogLevel("trace");
    // It carries no configuration of its own, so it inherits ["server", "mqtt"]:
    // that logger's single (overridden) sink set, hence one line and not two.
    // That it also inherits the MQTT *level knob* can only be shown with
    // LOG_LEVEL_MQTT actually set, which the boot-environment cases below do —
    // with the floor alone, this assertion would hold with no MQTT logger at all.
    const line = onlyLine(() => log("mqtt", "discovery").info("published 42 configs"));
    expect(line.category).toBe("server.mqtt.discovery");
  });
});

describe("LogTape's own diagnostics", () => {
  test("a meta warning survives even a fatal-only floor", () => {
    // The meta logger carries no filter on purpose: a misconfigured sink must
    // still be able to say so however quiet the operator has turned the server.
    applyLogLevel("fatal");
    const line = onlyLine(() => getLogger(["logtape", "meta"]).warn("sink is slow"));
    expect(line.category).toBe("logtape.meta");
  });

  test("meta chatter below warning is silenced", () => {
    applyLogLevel("trace");
    expect(emitted(() => getLogger(["logtape", "meta"]).info("logger configured"))).toEqual([]);
  });
});

describe("rendering a log line for the viewer", () => {
  test("a message with no interpolation is passed through verbatim", () => {
    applyLogLevel("trace");
    expect(onlyLine(() => log("render").info("poll loop started")).message).toBe(
      "poll loop started",
    );
  });

  test("an interpolated string is inlined without JSON quotes", () => {
    applyLogLevel("trace");
    expect(rendered("deye-sun-12k")).toBe("value=deye-sun-12k");
  });

  test("zero is a reading, not a missing value", () => {
    applyLogLevel("trace");
    expect(rendered(0)).toBe("value=0");
  });

  test("a negative reading keeps its sign", () => {
    applyLogLevel("trace");
    // Export is negative grid power and −7.5 °C is a temperature; neither may
    // be swallowed on the way to the viewer.
    expect(rendered(-7.5)).toBe("value=-7.5");
  });

  test("false renders as false rather than vanishing", () => {
    applyLogLevel("trace");
    expect(rendered(false)).toBe("value=false");
  });

  test("an absent value is spelled out", () => {
    applyLogLevel("trace");
    expect(rendered(null)).toBe("value=null");
    expect(rendered(undefined)).toBe("value=undefined");
  });

  test("objects and arrays are rendered as JSON", () => {
    applyLogLevel("trace");
    expect(rendered({ soc: 55, charging: true })).toBe('value={"soc":55,"charging":true}');
    expect(rendered([1, 2, 3])).toBe("value=[1,2,3]");
    expect(rendered({})).toBe("value={}");
  });

  test("an interpolated error keeps the reason it failed", () => {
    applyLogLevel("trace");
    // Every "…failed: {error}" call site in the server hands the caught Error
    // straight through. Errors have no enumerable properties, so JSON alone
    // renders `{}` and the operator reads a failure with no cause.
    expect(rendered(new Error("ECONNREFUSED 192.168.1.50:502"))).toBe(
      "value=Error: ECONNREFUSED 192.168.1.50:502",
    );
  });

  test("an error subclass keeps its own name", () => {
    applyLogLevel("trace");
    class ModbusError extends Error {
      override name = "ModbusError";
    }
    expect(rendered(new ModbusError("illegal data address"))).toBe(
      "value=ModbusError: illegal data address",
    );
  });

  test("a value that cannot be serialised falls back to its string form", () => {
    applyLogLevel("trace");
    const circular: Record<string, unknown> = { register: 0x0064 };
    circular.self = circular;
    expect(rendered(circular)).toBe("value=[object Object]");
  });

  test("a bigint register value falls back to its string form instead of throwing", () => {
    applyLogLevel("trace");
    // JSON.stringify throws on bigint; a throwing sink would take the log line
    // (and its caller) down with it.
    expect(rendered(10n)).toBe("value=10");
  });

  test("several values in one message are all interpolated in order", () => {
    applyLogLevel("trace");
    const line = onlyLine(() =>
      log("render").warn("write {key}={value} failed: {error}", {
        key: "battery_soc_limit",
        value: 0,
        error: new Error("timeout"),
      }),
    );
    expect(line.message).toBe("write battery_soc_limit=0 failed: Error: timeout");
  });

  test("a template-literal message is rendered the same way", () => {
    applyLogLevel("trace");
    const line = onlyLine(() => log("render").info`soc ${0}% of ${{ capacity: 10 }}`);
    expect(line.message).toBe('soc 0% of {"capacity":10}');
  });

  test("a line carries the record's own timestamp, in epoch milliseconds", () => {
    applyLogLevel("trace");
    const before = Date.now();
    const line = onlyLine(() => log("render").info("tick"));
    expect(line.time).toBeGreaterThanOrEqual(before);
    expect(line.time).toBeLessThanOrEqual(Date.now());
  });
});

describe("the live subscribers", () => {
  test("each line is pushed as it happens, in order", () => {
    applyLogLevel("trace");
    const seen: string[] = [];
    const unsubscribe = streams.subscribe("logs", (entry) => seen.push(entry.message));
    log("listener").info("first");
    log("listener").info("second");
    unsubscribe();
    expect(seen).toEqual(["first", "second"]);
  });

  test("every subscriber is fed, not just the most recent", () => {
    // The old single-`let` sink was last-writer-wins: registering a second
    // listener silently unhooked the first. The bus fans one line out to every
    // subscriber, which is what lets more than one WS client watch the log.
    applyLogLevel("trace");
    const first: string[] = [];
    const second: string[] = [];
    const unsubFirst = streams.subscribe("logs", (entry) => first.push(entry.message));
    const unsubSecond = streams.subscribe("logs", (entry) => second.push(entry.message));
    log("listener").info("fan out");
    unsubFirst();
    unsubSecond();
    expect(first).toEqual(["fan out"]);
    expect(second).toEqual(["fan out"]);
  });

  test("detaching stops delivery without stopping logging", () => {
    applyLogLevel("trace");
    const seen: LogEntry[] = [];
    const unsubscribe = streams.subscribe("logs", (entry) => seen.push(entry));
    unsubscribe();
    const buffered = recentLogs().length;
    log("listener").info("after the socket closed");
    expect(seen).toEqual([]);
    expect(recentLogs()).toHaveLength(buffered + 1);
  });

  test("a subscriber that throws loses neither the line nor the next one", () => {
    applyLogLevel("trace");
    const survivors: string[] = [];
    const unsubThrow = streams.subscribe("logs", () => {
      throw new Error("broadcast socket closed");
    });
    expect(() => log("listener").warn("dropped frame")).not.toThrow();
    const unsubSurvivor = streams.subscribe("logs", (entry) => survivors.push(entry.message));
    log("listener").warn("still logging");
    unsubThrow();
    unsubSurvivor();
    expect(survivors).toEqual(["still logging"]);
    expect(recentLogs().at(-2)?.message).toBe("dropped frame");
  });
});

describe("the replay buffer", () => {
  test("a filtered-out record is never retained for replay", () => {
    applyLogLevel("error");
    const before = recentLogs().length;
    log("buffer").debug("chatty");
    expect(recentLogs()).toHaveLength(before);
  });

  test("callers get a snapshot they cannot corrupt", () => {
    applyLogLevel("trace");
    log("buffer").info("retained");
    const snapshot = recentLogs();
    snapshot.length = 0;
    snapshot.push({ time: 0, level: "info", category: "forged", message: "forged" });
    expect(recentLogs().at(-1)?.message).toBe("retained");
    expect(recentLogs().some((l) => l.category === "forged")).toBe(false);
  });

  // Last: this fills the ring, so any later "buffer grew by one" assertion
  // would be measuring a buffer that is already evicting.
  test("the ring keeps the newest 500 lines and drops the oldest", () => {
    applyLogLevel("trace");
    for (let i = 0; i < 520; i++) log("buffer").info(`line ${i}`);
    const lines = recentLogs();
    expect(lines).toHaveLength(500);
    expect(lines.at(-1)?.message).toBe("line 519");
    expect(lines[0]?.message).toBe("line 20");
  });
});

/**
 * The boot default and the MQTT env knob are resolved at module load, so each
 * case boots the module in its own process with a controlled environment and
 * reports what came out. `###`-prefixed line so the console sink's own output
 * can't be mistaken for the result.
 */
const BOOT_PROBE = `
const logging = await import(process.env.LOGGING_MODULE);
for (const method of ["debug", "info", "warn", "error"]) console[method] = () => {};
await logging.setupLogging();
logging.log("runtime").debug("runtime debug");
logging.log("runtime").info("runtime info");
logging.log("runtime").warn("runtime warn");
logging.log("mqtt").debug("mqtt debug");
logging.log("mqtt").warn("mqtt warn");
logging.log("mqtt", "discovery").debug("mqtt discovery debug");
logging.log("mqtt", "discovery").warn("mqtt discovery warn");
process.stdout.write("###" + JSON.stringify({
  boot: logging.defaultLogLevel(),
  effective: logging.currentLogLevel(),
  lines: logging.recentLogs().map((entry) => entry.message),
}) + "\\n");
`;

/**
 * A second `setupLogging()` must skip the work rather than repeat it: its
 * `configure({ reset: true })` disposes the sinks the running server is already
 * logging through. The wiring is torn down between the two calls, so the second
 * call putting anything back is exactly what a missing guard looks like — and
 * that can only be observed in a process this file is free to leave unconfigured.
 */
const IDEMPOTENCE_PROBE = `
const logging = await import(process.env.LOGGING_MODULE);
const { configure } = await import("@logtape/logtape");
for (const method of ["debug", "info", "warn", "error"]) console[method] = () => {};
await logging.setupLogging();
logging.log("setup").warn("wired");
await configure({ reset: true, sinks: {}, loggers: [] });
await logging.setupLogging();
logging.log("setup").warn("after the second setup call");
process.stdout.write("###" + JSON.stringify({
  lines: logging.recentLogs().map((entry) => entry.message),
}) + "\\n");
`;

type BootResult = { boot: LogLevel; effective: LogLevel; lines: string[] };

/** Run a probe script in a fresh process under the given environment. */
async function probe<T>(script: string, vars: Record<string, string>): Promise<T> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const key of ["LOG_LEVEL", "LOG_LEVEL_MQTT", "NODE_ENV"]) delete env[key];
  const child = Bun.spawn(["bun", "-e", script], {
    // `@logtape/logtape` is installed under apps/server, not hoisted to the
    // workspace root, so the child has to resolve bare specifiers from here.
    cwd: import.meta.dir,
    env: {
      ...env,
      SKIP_ENV_VALIDATION: "1",
      LOGGING_MODULE: `${import.meta.dir}/logging.ts`,
      ...vars,
    },
    stdout: "pipe",
    stderr: "ignore",
  });
  const stdout = await new Response(child.stdout).text();
  const marker = stdout.split("\n").find((line) => line.startsWith("###"));
  if (!marker) throw new Error(`probe produced no result: ${stdout}`);
  return JSON.parse(marker.slice(3)) as T;
}

/** Boot the logging module in a fresh process under the given environment. */
function boot(vars: Record<string, string>): Promise<BootResult> {
  return probe<BootResult>(BOOT_PROBE, vars);
}

describe("setup", () => {
  test("a second setup call is skipped, not replayed over the live wiring", async () => {
    const result = await probe<{ lines: string[] }>(IDEMPOTENCE_PROBE, {
      NODE_ENV: "development",
    });
    // The second call reconfiguring would restore the sinks torn down in
    // between, and the line after it would be buffered like the first one.
    expect(result.lines).toEqual(["wired"]);
  }, 20_000);
});

describe("the boot default, read from the environment", () => {
  test("development boots verbose and production boots quiet", async () => {
    const [dev, prod] = await Promise.all([
      boot({ NODE_ENV: "development" }),
      boot({ NODE_ENV: "production" }),
    ]);
    expect(dev.boot).toBe("debug");
    expect(dev.lines).toContain("runtime debug");
    expect(prod.boot).toBe("info");
    expect(prod.lines).not.toContain("runtime debug");
    expect(prod.lines).toContain("runtime info");
  }, 20_000);

  test("an explicit LOG_LEVEL wins over the environment's default", async () => {
    const result = await boot({ NODE_ENV: "development", LOG_LEVEL: "warning" });
    expect(result.boot).toBe("warning");
    expect(result.effective).toBe("warning");
    expect(result.lines).toEqual(["runtime warn", "mqtt warn", "mqtt discovery warn"]);
  }, 20_000);

  test("LOG_LEVEL_MQTT keeps the broker verbose while the rest of the server is quiet", async () => {
    const result = await boot({
      NODE_ENV: "production",
      LOG_LEVEL: "error",
      LOG_LEVEL_MQTT: "debug",
    });
    // The nested category has no config of its own, so its presence here is what
    // proves the knob is inherited down the whole MQTT subtree, not just applied
    // to ["server", "mqtt"] itself.
    expect(result.lines).toEqual([
      "mqtt debug",
      "mqtt warn",
      "mqtt discovery debug",
      "mqtt discovery warn",
    ]);
  }, 20_000);

  test("LOG_LEVEL_MQTT can also quieten the broker below the server floor", async () => {
    const result = await boot({
      NODE_ENV: "production",
      LOG_LEVEL: "debug",
      LOG_LEVEL_MQTT: "error",
    });
    expect(result.lines).toEqual(["runtime debug", "runtime info", "runtime warn"]);
  }, 20_000);
});

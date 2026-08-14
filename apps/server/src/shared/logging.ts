/**
 * LogTape wiring for the server. `setupLogging()` must run (and be awaited)
 * before anything logs — Elysia's request logger and every app logger below
 * flow through the sinks configured here.
 *
 * Category tree:
 *   ["server", ...]        — app logs (mqtt, runtime, api, and the HTTP
 *                            request logger mounted as ["server", "http"])
 *   ["inverter-core", ...] — Modbus engine library logs (read plan, fallbacks)
 */

import { env } from "@SunReye/env/server";
import {
  ansiColorFormatter,
  configure,
  getConsoleSink,
  getLogger,
  type LogLevel,
  type LogRecord,
  type Sink,
} from "@logtape/logtape";

/** Root category for all application (non-HTTP) logs. */
const ROOT = "server" as const;

/**
 * A single log line in transport shape — flat and JSON-serialisable so it can
 * ride the `/ws/logs` WebSocket to the admin log viewer unchanged. Shared with
 * the web client, which imports this type from `server/src/shared/logging`.
 */
export type LogEntry = {
  /** Epoch milliseconds. */
  time: number;
  level: LogLevel;
  /** Dotted category path, e.g. `server.mqtt` or `elysia`. */
  category: string;
  /** Fully-rendered message (template literals with values interpolated). */
  message: string;
};

/** How many recent lines to retain so a freshly-connected viewer has context. */
const BUFFER_MAX = 500;
const buffer: LogEntry[] = [];

/** Notified with each new line (the server wires this to the WS broadcast). */
export type LogListener = (entry: LogEntry) => void;
let listener: LogListener | null = null;

/**
 * Register the push listener (the server wires this to a WS broadcast). Only one
 * is needed — the socket layer fans out to every subscriber.
 */
export function setLogListener(fn: LogListener | null): void {
  listener = fn;
}

/** The retained recent lines, oldest first — sent to a viewer on connect. */
export function recentLogs(): LogEntry[] {
  return [...buffer];
}

/**
 * Render one interpolated value: strings verbatim, everything else as JSON.
 * `JSON.stringify` yields `undefined` for functions and `undefined` itself, and
 * `String()` reproduces the plain concatenation that would have coerced it.
 * Circular structures throw, and fall back to `String(value)`.
 */
function renderValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return String(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

/**
 * Render a LogTape message template to a plain string. The message array
 * alternates string literals (even indices) with interpolated values (odd),
 * e.g. `["write failed: ", err, ""]`.
 */
function renderMessage(message: readonly unknown[]): string {
  let out = "";
  for (let i = 0; i < message.length; i++) {
    out += i % 2 === 0 ? String(message[i]) : renderValue(message[i]);
  }
  return out;
}

/**
 * LogTape sink that mirrors every record into the in-memory ring buffer and
 * forwards it to the live listener. Deliberately does no logging of its own so
 * it can never feed back into itself.
 */
const streamSink: Sink = (record: LogRecord) => {
  const entry: LogEntry = {
    time: record.timestamp,
    level: record.level,
    category: record.category.join("."),
    message: renderMessage(record.message),
  };
  buffer.push(entry);
  if (buffer.length > BUFFER_MAX) buffer.shift();
  listener?.(entry);
};

/**
 * Boot-time default severity. Explicit `LOG_LEVEL` wins; otherwise verbose in
 * development, quiet elsewhere. The *effective* level is {@link runtimeLevel},
 * which starts here and can be moved at runtime (Settings → Logs).
 */
const defaultLevel: LogLevel = env.LOG_LEVEL ?? (env.NODE_ENV === "development" ? "debug" : "info");

/**
 * The live severity floor. Loggers are configured with `lowestLevel: "trace"`
 * and gated through filters that read this variable per record, so changing it
 * takes effect instantly — LogTape's `lowestLevel` itself is fixed at
 * `configure()` time and would need a full reconfigure.
 */
let runtimeLevel: LogLevel = defaultLevel;

/** The effective server log level right now. */
export function currentLogLevel(): LogLevel {
  return runtimeLevel;
}

/** The boot default the runtime level falls back to when unset. */
export function defaultLogLevel(): LogLevel {
  return defaultLevel;
}

/** Move the live severity floor; `null` returns to the boot default. */
export function applyLogLevel(level: LogLevel | null): void {
  runtimeLevel = level ?? defaultLevel;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warning: 3,
  error: 4,
  fatal: 5,
};

/** Filter passing records at or above a (lazily read) severity floor. */
const atLeast = (floor: () => LogLevel) => (record: LogRecord) =>
  LEVEL_PRIORITY[record.level] >= LEVEL_PRIORITY[floor()];

let configured = false;

/** Configure LogTape's sinks and loggers. Idempotent. */
export async function setupLogging(): Promise<void> {
  if (configured) return;
  configured = true;
  await configure({
    reset: true,
    sinks: {
      // Colorized, human-readable output in dev; plain in prod so log
      // shippers/journald get clean lines.
      console: getConsoleSink({
        formatter: env.NODE_ENV === "development" ? ansiColorFormatter : undefined,
      }),
      // Fan every record into the ring buffer + live listener for `/ws/logs`.
      stream: streamSink,
    },
    filters: {
      // The runtime-adjustable floor (Settings → Logs / applyLogLevel).
      runtime: atLeast(() => runtimeLevel),
      // MQTT keeps its env knob when set, else follows the runtime floor.
      mqtt: atLeast(() => env.LOG_LEVEL_MQTT ?? runtimeLevel),
    },
    // `lowestLevel: "trace"` everywhere — the filters above do the real gating
    // so the level can move at runtime without reconfiguring LogTape.
    loggers: [
      {
        category: [ROOT],
        sinks: ["console", "stream"],
        filters: ["runtime"],
        lowestLevel: "trace",
      },
      // MQTT gets its own level knob (LOG_LEVEL_MQTT). `parentSinks: "override"`
      // detaches it from the [ROOT] sinks — without it every record would hit
      // the inherited sinks too and print twice.
      {
        category: [ROOT, "mqtt"],
        sinks: ["console", "stream"],
        parentSinks: "override",
        filters: ["mqtt"],
        lowestLevel: "trace",
      },
      // Library logs from the Modbus engine (read plan, atomic-read fallbacks).
      {
        category: ["inverter-core"],
        sinks: ["console", "stream"],
        filters: ["runtime"],
        lowestLevel: "trace",
      },
      // Silence LogTape's own meta warnings below "warning".
      { category: ["logtape", "meta"], sinks: ["console", "stream"], lowestLevel: "warning" },
    ],
  });
}

/** App logger under the shared root, e.g. `log("mqtt")` → ["server", "mqtt"]. */
export function log(...subcategory: string[]) {
  return getLogger([ROOT, ...subcategory]);
}

/**
 * LogTape wiring for the server. `setupLogging()` must run (and be awaited)
 * before anything logs — Elysia's request logger and every app logger below
 * flow through the sinks configured here.
 *
 * Category tree:
 *   ["server", ...]  — app logs (mqtt, runtime, api)
 *   ["elysia"]       — HTTP request logs from `@logtape/elysia`
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
 * the web client, which imports this type from `server/src/logging`.
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
type LogListener = (entry: LogEntry) => void;
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
 * Render a LogTape message template to a plain string. The message array
 * alternates string literals (even indices) with interpolated values (odd),
 * e.g. `["write failed: ", err, ""]`.
 */
function renderMessage(message: readonly unknown[]): string {
  let out = "";
  for (let i = 0; i < message.length; i++) {
    const part = message[i];
    if (i % 2 === 0) {
      out += typeof part === "string" ? part : String(part);
    } else if (typeof part === "string") {
      out += part;
    } else {
      try {
        out += JSON.stringify(part);
      } catch {
        out += String(part);
      }
    }
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
 * Lowest severity that reaches the console. Explicit `LOG_LEVEL` wins; otherwise
 * verbose in development, quiet elsewhere.
 */
const lowestLevel: LogLevel = env.LOG_LEVEL ?? (env.NODE_ENV === "development" ? "debug" : "info");

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
    loggers: [
      { category: [ROOT], sinks: ["console", "stream"], lowestLevel },
      { category: ["elysia"], sinks: ["console", "stream"], lowestLevel },
      // Silence LogTape's own meta warnings below "warning".
      { category: ["logtape", "meta"], sinks: ["console", "stream"], lowestLevel: "warning" },
    ],
  });
}

/** App logger under the shared root, e.g. `log("mqtt")` → ["server", "mqtt"]. */
export function log(...subcategory: string[]) {
  return getLogger([ROOT, ...subcategory]);
}

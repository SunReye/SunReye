/**
 * Log wire shapes shared by the server and the web app.
 *
 * These are the definition site: the server's `shared/logging.ts` imports
 * {@link LogEntry} back, and the web log store imports it from
 * `@SunReye/contracts/logs`. Type-only — no runtime tail (see AGENTS.md).
 *
 * {@link LogLevel} is **declared** here rather than re-exported from
 * `@logtape/logtape`, so a logging library's types never enter the browser's
 * type graph. The union is kept in sync with LogTape by a compile-time drift
 * guard: `shared/logging.ts` builds a {@link LogEntry} with `level: record.level`
 * (a LogTape `LogLevel`), which stops compiling the moment LogTape adds a level
 * this union is missing.
 */

/** Severity of a log line — the LogTape level set, restated for the wire. */
export type LogLevel = "trace" | "debug" | "info" | "warning" | "error" | "fatal";

/**
 * A single log line in transport shape — flat and JSON-serialisable so it can
 * ride the `/ws/logs` WebSocket to the admin log viewer unchanged.
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

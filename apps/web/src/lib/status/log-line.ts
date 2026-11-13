/** A line of the core's log buffer (ADR 2), split as `tracing`'s default format writes it. */
export interface LogLine {
  /** RFC 3339, as the core wrote it; absent on a line it did not format, such as a backtrace's. */
  readonly time?: string | undefined;
  readonly level?: Level | undefined;
  readonly message: string;
}

const LEVELS = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR"] as const;

export type Level = (typeof LEVELS)[number];

/** The levels a filter keeps: every line, warnings and errors, or errors only. */
export type LevelFilter = "all" | "warn" | "error";

const FORMAT = /^(\S+)\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s(.*)$/u;

export function logLine(line: string): LogLine {
  const parts = FORMAT.exec(line);

  if (parts === null) return { message: line.trim() };

  const [, time, level, message = ""] = parts;

  return { time, level: LEVELS.find((known) => known === level), message: message.trim() };
}

export function keeps(filter: LevelFilter, level: Level | undefined): boolean {
  if (filter === "all") return true;

  return level === "ERROR" || (filter === "warn" && level === "WARN");
}

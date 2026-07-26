import type { LogEntry } from "$lib/logs/store.svelte";

/** Text colour per severity; the key order also drives the level menus. */
export const LEVEL_CLASS: Record<LogEntry["level"], string> = {
  trace: "text-muted-foreground",
  debug: "text-muted-foreground",
  info: "text-foreground",
  warning: "text-amber-500",
  error: "text-red-500",
  fatal: "text-red-500",
};

export const LEVELS = Object.keys(LEVEL_CLASS) as LogEntry["level"][];

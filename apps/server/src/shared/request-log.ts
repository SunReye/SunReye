/**
 * Structured HTTP request logging.
 *
 * Replaces `@logtape/elysia`, which pins `elysia: ^1.4.0` in every published
 * version and constructs against `.onRequest` — a hook Elysia 2 renamed, so it
 * threw at app construction, before a single request. That is a boot failure no
 * unit test sees, because nothing builds the composition root without a
 * database; hence this module, which is small enough to test on its own.
 *
 * Timing is keyed off the `Request` in a WeakMap, not off `store`: `store` is
 * app-level and shared by every in-flight request, so a start time parked there
 * is whichever request most recently arrived, not this one.
 */
import { Elysia } from "elysia";
import { log } from "./logging";

export interface RequestLogEntry {
  method: string;
  path: string;
  status: number;
  durationMs: number;
}

export interface RequestLogOptions {
  /** Requests to leave out of the log — high-frequency, low-information ones. */
  skip?: (ctx: { method: string; path: string }) => boolean;
  /** Where a finished request goes. Defaults to the `["server", "http"]` logger. */
  emit?: (entry: RequestLogEntry) => void;
}

/**
 * The default sink: one line per request under `["server", "http"]`, so HTTP
 * lines read like every other source instead of a plugin's own category.
 */
const httpLog = log("http");
const logLine = (entry: RequestLogEntry): void => {
  httpLog.info("{method} {path} {status} in {durationMs}ms", { ...entry });
};

const round2 = (ms: number): number => Math.round(ms * 100) / 100;

export function requestLogger(options: RequestLogOptions = {}) {
  const emit = options.emit ?? logLine;
  const skip = options.skip;
  const startedAt = new WeakMap<Request, number>();

  // `.as("global")` and not the default: a plugin's hooks are local to the
  // plugin in Elysia 2, and a logger that only sees its own (zero) routes logs
  // nothing at all.
  return (
    new Elysia({ name: "request-logger" })
      .request(({ request }) => {
        startedAt.set(request, performance.now());
      })
      // `afterResponse` runs for every outcome the client actually saw — a served
      // route, an unmatched path, a thrown handler — which is why the status is
      // read here and not in the handler chain.
      .afterResponse(({ request, path, set }) => {
        const started = startedAt.get(request);
        startedAt.delete(request);
        if (skip?.({ method: request.method, path })) return;
        emit({
          method: request.method,
          path,
          status: typeof set.status === "number" ? set.status : 200,
          // Two decimals: a raw performance.now() delta prints seventeen digits.
          durationMs: started === undefined ? 0 : round2(performance.now() - started),
        });
      })
      .as("global")
  );
}

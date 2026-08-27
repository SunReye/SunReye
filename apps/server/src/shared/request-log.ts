/**
 * Structured HTTP request logging, and the per-request correlation id.
 *
 * Replaces `@logtape/elysia`, which pins `elysia: ^1.4.0` in every published
 * version and constructs against `.onRequest` — a hook Elysia 2 renamed, so it
 * threw at app construction, before a single request. That is a boot failure no
 * unit test sees, because nothing builds the composition root without a
 * database; hence this module, which is small enough to test on its own.
 *
 * It keeps the plugin's two features worth keeping:
 *
 * - **One line per request**, with the query string — that is what tells two
 *   history requests apart, and logging only the path lost it.
 * - **A correlation id** on the response and, via ./request-context, on every
 *   record emitted while the request is handled. That is the part a flat log
 *   cannot reconstruct afterwards.
 *
 * Timing is keyed off the `Request` in a WeakMap, not off `store`: `store` is
 * app-level and shared by every in-flight request, so a start time parked there
 * is whichever request most recently arrived, not this one. The old plugin read
 * `performance.now() - store.startTime`, which under load reported one
 * request's elapsed time for another.
 */
import { Elysia } from "elysia";
import type { LogLevel } from "@logtape/logtape";
import { log } from "./logging";
import { CORRELATION_HEADER, correlationId, enterRequestContext } from "./request-context";

export interface RequestLogEntry {
  method: string;
  path: string;
  /** The search string including `?`, or empty — never undefined. */
  query: string;
  status: number;
  durationMs: number;
  requestId: string;
  level: LogLevel;
}

export interface RequestLogOptions {
  /** Requests to leave out of the log — high-frequency, low-information ones. */
  skip?: (ctx: { method: string; path: string }) => boolean;
  /** Level for the request line itself. Defaults to `info`. */
  level?: LogLevel;
  /** Where a finished request goes. Defaults to the `["server", "http"]` logger. */
  emit?: (entry: RequestLogEntry) => void;
}

/**
 * The default sink: one line per request under `["server", "http"]`, so HTTP
 * lines read like every other source instead of a plugin's own category.
 */
const httpLog = log("http");
const logLine = (entry: RequestLogEntry): void => {
  httpLog[entry.level]("{method} {path}{query} {status} in {durationMs}ms", { ...entry });
};

const round2 = (ms: number): number => Math.round(ms * 100) / 100;

/** The search string, taken from the raw URL so nothing has to re-parse it. */
const queryOf = (url: string): string => {
  const at = url.indexOf("?");
  return at === -1 ? "" : url.slice(at);
};

export function requestLogger(options: RequestLogOptions = {}) {
  const emit = options.emit ?? logLine;
  const level = options.level ?? "info";
  const skip = options.skip;
  const startedAt = new WeakMap<Request, number>();
  const idOf = new WeakMap<Request, string>();

  // `.as("global")` and not the default: a plugin's hooks are local to the
  // plugin in Elysia 2, and a logger that only sees its own (zero) routes logs
  // nothing at all.
  return (
    new Elysia({ name: "request-logger" })
      .request(({ request, set }) => {
        startedAt.set(request, performance.now());
        const id = correlationId(request.headers.get(CORRELATION_HEADER));
        idOf.set(request, id);
        // Echoed here and not in `afterResponse`: that hook runs once the response
        // has been built, so a header set there never reaches the client. Echoed
        // even for a request we go on to skip — a caller correlating its own trace
        // should not have to care which paths we chose not to log.
        set.headers[CORRELATION_HEADER] = id;
        // Binds the id to this request's async context, so anything the handler
        // awaits logs with it — see ./request-context.
        enterRequestContext(id);
      })
      // `afterResponse` runs for every outcome the client actually saw — a served
      // route, an unmatched path, a thrown handler — which is why the status is
      // read here and not in the handler chain.
      .afterResponse(({ request, path, set }) => {
        const started = startedAt.get(request);
        const id = idOf.get(request) ?? correlationId(null);
        startedAt.delete(request);
        idOf.delete(request);

        if (skip?.({ method: request.method, path })) return;
        emit({
          method: request.method,
          path,
          query: queryOf(request.url),
          status: typeof set.status === "number" ? set.status : 200,
          durationMs: started === undefined ? 0 : round2(performance.now() - started),
          requestId: id,
          level,
        });
      })
      .as("global")
  );
}

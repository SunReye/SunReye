// fallow-ignore-file coverage-gaps -- replays reads against a live core; run by hand with `bun run bench`.
// Range reads coalesced as the SPA sends them (ADR 9, 11): the series of one device, range and
// period asked in the same task go as one request of at most 16.
import type { Body, Read } from "./reads.ts";

/** The most series one range request reads (ADR 9). */
const MOST = 16;

/** A device's history, statistics or forecasts. */
const RANGE = /^\/api\/v1\/devices\/\d+\/(?:history|statistics|forecasts)$/u;

/** Each chunk of `names`, at most 16, read from `route` with the query `rest`, and its names. */
function send(read: Read, names: readonly string[], route: string, rest: string) {
  const sent: { names: readonly string[]; answer: Promise<Body> }[] = [];

  for (let i = 0; i < names.length; i += MOST) {
    const chunk = names.slice(i, i + MOST);
    const series = chunk.map((name) => `series=${encodeURIComponent(name)}`).join("&");

    sent.push({ names: chunk, answer: read(`${route}?${series}${rest === "" ? "" : `&${rest}`}`) });
  }

  return sent;
}

/**
 * `read` with the range reads of one device, range and period asked in the same task sent as one
 * request of their series, at most 16. Each caller gets the answer of the request that read its
 * first series.
 */
export function coalescing(read: Read): Read {
  const pending = new Map<string, Map<string, PromiseWithResolvers<Body>>>();

  const flush = (key: string, route: string, rest: string): void => {
    const batch = pending.get(key) ?? new Map<string, PromiseWithResolvers<Body>>();

    pending.delete(key);

    for (const { names, answer } of send(read, [...batch.keys()], route, rest))
      for (const name of names) batch.get(name)?.resolve(answer);
  };

  return (path) => {
    const [route = "", query = ""] = path.split("?");

    if (!RANGE.test(route)) return read(path);

    const params = new URLSearchParams(query);
    const series = params.getAll("series");

    params.delete("series");

    const rest = params.toString();
    const key = `${route}?${rest}`;
    const batch = pending.get(key) ?? new Map<string, PromiseWithResolvers<Body>>();

    if (!pending.has(key)) {
      pending.set(key, batch);
      queueMicrotask(() => {
        flush(key, route, rest);
      });
    }

    const waits = series.map((name) => {
      const known = batch.get(name) ?? Promise.withResolvers<Body>();

      batch.set(name, known);

      return known.promise;
    });

    return waits[0] ?? read(path);
  };
}

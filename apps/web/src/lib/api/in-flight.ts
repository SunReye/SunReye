// Range reads asked twice at once (ADR 11): screens that open together often read the same series
// over the same span. While one is in flight, the same read joins it; once it settles, nothing is
// kept, as a range's figures move on.

/** A device's history, statistics or forecasts over a span. */
const RANGE = /\/api\/v1\/devices\/\d+\/(?:history|statistics|forecasts)$/u;

/** `fetch` with each range read in flight shared, by URL, among every caller asking it meanwhile. */
export function sharing(
  fetch: (request: Request) => Promise<Response>,
): (request: Request) => Promise<Response> {
  const running = new Map<string, Promise<Response>>();

  return (request) => {
    if (request.method !== "GET" || !RANGE.test(new URL(request.url).pathname))
      return fetch(request);

    const key = request.url;
    let asked = running.get(key);

    if (asked === undefined) {
      const own = fetch(request);

      const settled = () => {
        if (running.get(key) === own) running.delete(key);
      };

      running.set(key, own);
      own.then(settled, settled);
      asked = own;
    }

    // Each caller reads its own copy of the body.
    return asked.then((response) => response.clone());
  };
}

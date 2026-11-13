// A route page rendered on its own: a fake core in place of the root layout's, so no request
// reaches the test server.
import { afterEach, beforeEach, expect, vi } from "vitest";
import { connect } from "../lib/api/core.ts";
import { BASE, problem } from "../lib/api/core.harness.ts";
import { coreContext } from "../lib/shell/core.ts";

/** A core that knows nothing: it refuses every call, as a core before setup does. */
export function emptyCore(): Map<symbol, unknown> {
  return coreContext(
    connect({ base: BASE, fetch: () => Promise.resolve(problem(404, "not.found")) }),
  );
}

/** The API requests that went over the network since the test began. */
function apiRequests(): string[] {
  return (
    performance
      .getEntriesByType("resource")
      // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the DOM's own type.
      .map(({ name }) => new URL(name).pathname)
      .filter((path) => path.includes("/api/"))
  );
}

/** Fails a route test whose page reached past the fake core. */
export function keepOffline(): void {
  beforeEach(() => {
    performance.clearResourceTimings();
  });

  afterEach(() => {
    expect(apiRequests()).toEqual([]);
  });
}

/** Answers every fetch with a refusal, for the root layout, which connects its own core. */
export function refuseFetch(): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.resolve(problem(404, "not.found")),
  );
}

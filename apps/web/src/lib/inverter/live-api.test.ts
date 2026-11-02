import { expect, test } from "bun:test";
import createClient from "openapi-fetch";
import type { paths } from "$lib/core-api.gen";
import { fetchManifest, fetchRecent } from "./live-api";
import type { InverterManifest } from "./types";

/** The real openapi-fetch client over a canned transport, so answers have their real shape. */
function core(answer: (url: URL) => Response | Promise<Response>) {
  const seen: URL[] = [];
  const client = createClient<paths>({
    baseUrl: "http://core.test",
    fetch: async (request) => {
      const url = new URL(request.url);
      seen.push(url);
      return answer(url);
    },
  });
  return { client, seen };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const MANIFEST = {
  id: "deye-sg01hp3",
  metrics: [],
  capabilities: {},
} as unknown as InverterManifest;
const RECENT = {
  t0: 1_700_000_000_000,
  step: 1,
  metrics: { "battery.soc": { o: [0, 2], v: [55, 56] } },
};

test("the manifest is the body the core answers for the active profile", async () => {
  const { client, seen } = core(() => json(MANIFEST));
  expect(await fetchManifest(client)).toEqual(MANIFEST);
  expect(seen.map((u) => u.pathname)).toEqual(["/api/profile"]);
});

test("a 404 before a profile is chosen reads as no manifest, not as a failure", async () => {
  const { client } = core(() => json({ error: "no profile chosen" }, 404));
  expect(await fetchManifest(client)).toBeNull();
});

test("a refused session and an unreachable core both read as no manifest", async () => {
  const refused = core(() => json({ error: "unauthorized" }, 401));
  expect(await fetchManifest(refused.client)).toBeNull();
  const down = core(() => Promise.reject(new TypeError("fetch failed")));
  expect(await fetchManifest(down.client)).toBeNull();
});

test("recent history asks for the window and bucket width, scoped to nothing else", async () => {
  const { client, seen } = core(() => json(RECENT));
  expect(await fetchRecent(client, 300)).toEqual(RECENT);
  expect(seen.map((u) => u.pathname + u.search)).toEqual([
    "/api/history/recent?seconds=300&stepSeconds=1",
  ]);
});

test("a refused window and an unreachable core both read as no backfill", async () => {
  const refused = core(() => json({ error: "seconds must be 1–3600" }, 400));
  expect(await fetchRecent(refused.client, 9999)).toBeNull();
  const down = core(() => Promise.reject(new TypeError("fetch failed")));
  expect(await fetchRecent(down.client, 300)).toBeNull();
});

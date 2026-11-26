/// <reference types="bun" />
// three.js loads up front only on the builder route (ADR 11, 20); the dashboard loads it lazily,
// once a scene exists and WebGL2 is there. Scalar loads only with the API reference (ADR 11).
// Read from the SPA build's Vite manifest: its chunks and their static and dynamic imports.
// The gate builds the SPA before `bun test`; run `bun run --cwd apps/home/web build` first by hand.
import { expect, test } from "bun:test";

const web = new URL("../../", import.meta.url).pathname;
const client = `${web}.svelte-kit/output/client/`;

interface Chunk {
  readonly file: string;
  /** The module a chunk is named after, such as `three.core` for three.js's. */
  readonly name?: string;
  readonly imports?: readonly string[];
  readonly dynamicImports?: readonly string[];
  readonly isEntry?: boolean;
}

function isChunk(value: unknown): value is Chunk {
  return value instanceof Object && "file" in value && String(value.file) === value.file;
}

function isManifest(value: unknown): value is Readonly<Record<string, Chunk>> {
  return value instanceof Object && Object.values(value).every((chunk) => isChunk(chunk));
}

const parsed: unknown = await Bun.file(`${client}.vite/manifest.json`).json();

if (!isManifest(parsed)) throw new TypeError("not a Vite manifest");

const manifest = parsed;

/** The chunks whose code holds `marker`. Found by content, not name: Rollup names a merged chunk
 * after any of its modules. */
async function carrying(marker: string): Promise<Set<string>> {
  const keys = await Promise.all(
    Object.entries(manifest).map(async ([key, chunk]: readonly [string, Chunk]) =>
      (await Bun.file(`${client}${chunk.file}`).text()).includes(marker) ? [key] : [],
    ),
  );

  return new Set(keys.flat());
}

/** three.js's: its messages carry the `THREE.` prefix. */
const three = await carrying("THREE.");

/** Scalar's: its components carry the `scalar-app` class. */
const scalar = await carrying("scalar-app");

/** Every chunk `key` loads before it runs: itself and its static imports. */
function closure(key: string): Set<string> {
  const keys = new Set<string>();
  const queue = [key];

  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    if (!keys.has(next)) {
      keys.add(next);
      queue.push(...(manifest[next]?.imports ?? []));
    }
  }

  return keys;
}

/** Whether `key` loads up front a chunk `carries` picks. */
function loads(key: string, carries: (chunk: string) => boolean): boolean {
  return [...closure(key)].some((reached) => carries(reached));
}

/** The source route of each node entry, from the node module SvelteKit generated for it. */
async function route(key: string): Promise<string> {
  const source = await Bun.file(`${web}${key}`).text();

  return /src\/routes\/(.*)\+page\.svelte/u.exec(source)?.[1] ?? key;
}

test("only the builder route's chunks carry three.js up front", async () => {
  const entries = Object.keys(manifest).filter((key) => manifest[key]?.isEntry === true);

  expect(three.size).toBeGreaterThan(0);

  const carriers = await Promise.all(
    entries.filter((key) => loads(key, (chunk) => three.has(chunk))).map((key) => route(key)),
  );

  expect(carriers).toEqual(["builder/"]);
});

test("the dashboard reaches three.js only through the scene's lazy imports", async () => {
  const entries = Object.keys(manifest).filter((key) => manifest[key]?.isEntry === true);
  const routes = await Promise.all(entries.map(async (key) => [key, await route(key)] as const));
  const dashboard = routes.find(([, path]) => path === "")?.[0];

  // Rollup may hoist the lazy import into a chunk the route shares, so look
  // through everything the route loads up front.
  const lazy = [...closure(dashboard ?? "")].flatMap((key) => manifest[key]?.dynamicImports ?? []);

  const carriers = lazy.flatMap((key) =>
    loads(key, (chunk) => three.has(chunk)) ? [manifest[key]?.name] : [],
  );

  // Both load together once a scene is shown: the scene and the car models it draws.
  expect(carriers).toEqual(["LiveScene", "models"]);
});

test("only the API route's chunks carry Scalar up front", async () => {
  const entries = Object.keys(manifest).filter((key) => manifest[key]?.isEntry === true);

  expect(scalar.size).toBeGreaterThan(0);

  const carriers = await Promise.all(
    entries.filter((key) => loads(key, (chunk) => scalar.has(chunk))).map((key) => route(key)),
  );

  expect(carriers).toEqual(["api/"]);
});

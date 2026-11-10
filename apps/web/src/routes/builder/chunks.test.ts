/// <reference types="bun" />
// three.js loads up front only on the builder route (ADR 11, 20); the dashboard loads it lazily,
// once a scene exists and WebGL2 is there. Read from the SPA build's Vite manifest: its chunks and
// their static and dynamic imports.
// The gate builds the SPA before `bun test`; run `bun run --cwd apps/web build` first by hand.
import { expect, test } from "bun:test";

const web = new URL("../../../", import.meta.url).pathname;
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

/** The chunks three.js's modules are bundled into. */
const three = new Set(
  Object.keys(manifest).filter((key) => /^three(?:\.|$)/u.test(manifest[key]?.name ?? "")),
);

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

function loadsThree(key: string): boolean {
  return [...closure(key)].some((reached) => three.has(reached));
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
    entries.filter((key) => loadsThree(key)).map((key) => route(key)),
  );

  expect(carriers).toEqual(["builder/"]);
});

test("the dashboard reaches three.js only through the scene's lazy imports", async () => {
  const entries = Object.keys(manifest).filter((key) => manifest[key]?.isEntry === true);
  const routes = await Promise.all(entries.map(async (key) => [key, await route(key)] as const));
  const dashboard = routes.find(([, path]) => path === "")?.[0];

  const lazy = manifest[dashboard ?? ""]?.dynamicImports ?? [];
  const carriers = lazy.filter((key) => loadsThree(key)).map((key) => manifest[key]?.name);

  // Both load together once a scene is shown: the scene and the car models it draws.
  expect(carriers).toEqual(["LiveScene", "models"]);
});

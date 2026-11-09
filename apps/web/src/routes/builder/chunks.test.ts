/// <reference types="bun" />
// three.js loads only on the builder route (ADR 11, 20), read from the SPA build's chunk graph.
// The gate builds the SPA before `bun test`; run `bun run --cwd apps/web build` first by hand.
import { expect, test } from "bun:test";

const web = new URL("../../../", import.meta.url).pathname;
const client = `${web}.svelte-kit/output/client/`;

interface Chunk {
  readonly file: string;
  readonly imports?: readonly string[];
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

/** A string three.js's renderer carries through minification. */
const THREE = "THREE.WebGLRenderer";

/** Every file `key` loads before it runs: itself and its static imports. */
function closure(key: string): Set<string> {
  const files = new Set<string>();
  const queue = [key];

  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    const chunk = manifest[next];

    if (chunk !== undefined && !files.has(chunk.file)) {
      files.add(chunk.file);
      queue.push(...(chunk.imports ?? []));
    }
  }

  return files;
}

async function loadsThree(key: string): Promise<boolean> {
  const texts = await Promise.all(
    [...closure(key)].map((file) => Bun.file(`${client}${file}`).text()),
  );

  return texts.some((text) => text.includes(THREE));
}

/** The source route of each node entry, from the node module SvelteKit generated for it. */
async function route(key: string): Promise<string> {
  const source = await Bun.file(`${web}${key}`).text();

  return /src\/routes\/(.*)\+page\.svelte/u.exec(source)?.[1] ?? key;
}

test("only the builder route's chunks carry three.js", async () => {
  const entries = Object.keys(manifest).filter((key) => manifest[key]?.isEntry === true);

  const carriers = await Promise.all(
    entries.map(async (key) => ((await loadsThree(key)) ? route(key) : undefined)),
  );

  expect(carriers.filter((carrier) => carrier !== undefined)).toEqual(["builder/"]);
});

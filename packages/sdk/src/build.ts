import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadProfileWasm } from "./profile-wasm.ts";

/** One `index.json` entry (ADR 8), before signing. */
interface Entry {
  readonly id: string;
  readonly version: string;
  readonly schema: number;
  readonly requires: readonly string[];
  readonly sha256: string;
  readonly url: string;
}

/** A profile the build rendered, at its published version, with the loader's warnings. */
export interface Built {
  readonly id: string;
  readonly version: string;
  readonly warnings: readonly string[];
}

/** The fields of a profile the build reads; the rest passes through to the file untouched. */
interface Listable {
  readonly id: string;
  readonly version: string;
  readonly schema: number;
  readonly requires: readonly string[];
}

interface Result {
  readonly built: Built;
  readonly entry: Entry;
}

type Semver = readonly [number, number, number];

function isListable(value: unknown): value is Listable {
  return (
    value instanceof Object &&
    "id" in value &&
    String(value.id) === value.id &&
    "version" in value &&
    String(value.version) === value.version &&
    "schema" in value &&
    Number.isInteger(value.schema) &&
    "requires" in value &&
    Array.isArray(value.requires)
  );
}

/** A module namespace has a null prototype, so `instanceof Object` cannot narrow it. */
function hasDefault(module: unknown): module is { readonly default: unknown } {
  return Object.prototype.hasOwnProperty.call(module, "default");
}

/** The default export of the profile module at `path`. */
async function profileAt(path: string): Promise<Listable> {
  const absolute = resolve(path);
  // The query keys Bun's module cache by content, so a rebuild in one process sees an edit.
  const content = new Bun.CryptoHasher("sha256").update(await readFile(absolute)).digest("hex");
  const module: unknown = await import(`${absolute}?${content}`);
  const profile = hasDefault(module) ? module.default : undefined;

  if (!isListable(profile)) throw new TypeError(`${path} exports no profile by default`);

  return profile;
}

/** The profile's file: the exact bytes the index hashes and the profile key signs. */
function render(profile: Readonly<Listable>): string {
  return `${JSON.stringify(profile, undefined, 2)}\n`;
}

/** A profile file's text, or a profile module's as the build renders it. */
export async function renderedAt(path: string): Promise<string> {
  return path.endsWith(".json") ? readFile(path, "utf8") : render(await profileAt(path));
}

/** The last build of a profile at `path`, or `undefined` before its first. */
async function publishedAt(path: string): Promise<Listable | undefined> {
  const text = await readFile(path, "utf8").catch(() => "null");
  const published: unknown = JSON.parse(text);

  return isListable(published) ? published : undefined;
}

/** `major.minor.patch` as numbers; throws on anything else, which no core could order. */
function semver(version: string): Semver {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version);

  if (match === null) throw new Error(`version ${version} is not major.minor.patch`);

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function newer(a: Semver, b: Semver): boolean {
  const at = a.findIndex((part, i) => part !== b[i]);

  return at !== -1 && (a[at] ?? 0) > (b[at] ?? 0);
}

/**
 * `profile` at the version its build publishes: the source's version is a floor the author raises
 * to cut a minor or major; otherwise changed content bumps the published patch.
 */
function versioned(
  profile: Readonly<Listable>,
  published: Readonly<Listable> | undefined,
): Listable {
  if (published === undefined) return profile;

  const [major, minor, patch] = semver(published.version);

  if (newer(semver(profile.version), [major, minor, patch])) return profile;

  const same = Bun.deepEquals({ ...profile, version: "" }, { ...published, version: "" });

  return { ...profile, version: same ? published.version : `${major}.${minor}.${patch + 1}` };
}

/** Renders the profile module `name` in `dir` to `<id>.json` in `out`, and lists it. */
async function buildOne(dir: string, name: string, out: string): Promise<Result> {
  const wasm = await loadProfileWasm();
  const source = await profileAt(join(dir, name));
  const profile = versioned(source, await publishedAt(join(out, `${source.id}.json`)));
  const text = render(profile);
  const warnings = wasm.lint(text);

  await writeFile(join(out, `${profile.id}.json`), text);

  return {
    built: { id: profile.id, version: profile.version, warnings },
    entry: {
      id: profile.id,
      version: profile.version,
      schema: profile.schema,
      requires: profile.requires,
      sha256: new Bun.CryptoHasher("sha256").update(text).digest("hex"),
      url: `${profile.id}.json`,
    },
  };
}

/**
 * Renders every profile module in `dir` to validated `<id>.json` in `out`, and `index.json`
 * listing them. A profile's content is everything but its version; the last build's file in `out`
 * is the baseline it is compared with. Throws the loader's reason for a profile the core would
 * refuse.
 */
export async function buildProfiles(dir: string, out: string): Promise<Built[]> {
  const sources = (await readdir(dir))
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .toSorted();

  const results = await Promise.all(sources.map((name) => buildOne(dir, name, out)));
  const index = { profiles: results.map(({ entry }) => entry) };

  await writeFile(join(out, "index.json"), `${JSON.stringify(index, undefined, 2)}\n`);

  return results.map(({ built }) => built);
}

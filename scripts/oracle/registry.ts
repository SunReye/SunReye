// fallow-ignore-file unused-export -- the registry's pieces are exported for generate.ts and the tests; test files are not traced as consumers
/**
 * Which oracle generators exist, found by listing this directory: a new oracle file adds a
 * `scripts/oracle/<name>.ts` that exports `oracle`, its fixtures and (optionally) a case table
 * `fixtures/oracle/cases.d/<name>.md`, and edits no shared file.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import type { CorpusFiles } from "./corpus";

export interface OracleGenerator {
  /** The corpus entries it writes: top-level files or directories of `fixtures/oracle/`. */
  files: readonly string[];
  /** The generator reads the profile repository: `generate` refuses to run without it. */
  needsProfiles?: true;
  build(ctx: { profilesDir: string | null }): Promise<CorpusFiles>;
}

/** Files here that are not generators. Tests (`*.test.ts`) are skipped by name. */
export const HELPERS: readonly string[] = ["corpus", "generate", "registry"];

/** Entries `apps/server/db-tests/oracle.test.ts` writes, against a database. */
export const DATABASE_OWNED: readonly string[] = [
  "rollups.ndjson",
  "statistics.ndjson",
  "plant-rollups.ndjson",
  "archives",
];

/** Entries of `fixtures/oracle/` that are documentation. */
const DOCUMENTATION: readonly string[] = ["README.md", "cases.d"];

export const ORACLE_DIR = import.meta.dir;

/** Generator names (file basenames, sorted) in `dir`. */
export async function generatorNames(dir = ORACLE_DIR): Promise<string[]> {
  return (await readdir(dir))
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => f.slice(0, -".ts".length))
    .filter((name) => !HELPERS.includes(name))
    .sort();
}

export interface Discovered {
  name: string;
  oracle: OracleGenerator;
}

/** Import every generator file in `dir`; a file that exports no `oracle` is an error. */
export async function discoverGenerators(dir = ORACLE_DIR): Promise<Discovered[]> {
  const found: Discovered[] = [];
  for (const name of await generatorNames(dir)) {
    const module = (await import(join(dir, `${name}.ts`))) as { oracle?: OracleGenerator };
    if (typeof module.oracle?.build !== "function" || !Array.isArray(module.oracle.files)) {
      throw new Error(
        `scripts/oracle/${name}.ts exports no \`oracle\` ({ files, build }); export it, or add the file to HELPERS in registry.ts`,
      );
    }
    found.push({ name, oracle: module.oracle });
  }
  return found;
}

/** The top-level entries of the corpus directory that are fixtures. */
export async function readCorpusEntries(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter((entry) => !DOCUMENTATION.includes(entry)).sort();
}

/** File names in `cases.d/`, sorted; none when the directory is absent. */
async function caseTables(dir: string): Promise<string[]> {
  return (await readdir(join(dir, "cases.d")).catch(() => [])).sort();
}

/** The README and every case table in `cases.d/`, joined: where a case name must appear. */
export async function readDocumentation(dir: string): Promise<string> {
  const parts = [await readFile(join(dir, "README.md"), "utf8")];
  for (const table of await caseTables(dir)) {
    parts.push(await readFile(join(dir, "cases.d", table), "utf8"));
  }
  return parts.join("\n");
}

/** Case names of a corpus entry: each line's `case` or `profile.id`, or a directory's entries. */
async function caseNames(dir: string, entry: string): Promise<string[]> {
  if (!entry.endsWith(".ndjson")) return (await readdir(join(dir, entry)).catch(() => [])).sort();
  const text = await readFile(join(dir, entry), "utf8").catch(() => "");
  const names: unknown[] = [];
  for (const line of text.split("\n").filter((l) => l !== "")) {
    const row = JSON.parse(line) as { case?: unknown; profile?: { id?: unknown } };
    names.push(row.case ?? row.profile?.id);
  }
  return names.filter((name): name is string => typeof name === "string");
}

/** Cases the README and `cases.d/` do not document, and fragments no group owns. */
export async function documentationProblems(
  dir: string,
  generators: readonly Discovered[],
): Promise<string[]> {
  const documentation = await readDocumentation(dir);
  const entries = [...generators.flatMap((g) => g.oracle.files), ...DATABASE_OWNED];
  const problems: string[] = [];
  for (const entry of entries) {
    for (const name of await caseNames(dir, entry)) {
      if (!documentation.includes(`\`${name}\``)) {
        problems.push(`${entry}: \`${name}\` is in neither README.md nor cases.d/`);
      }
    }
  }
  const owners = [
    ...generators.map((g) => g.name),
    ...DATABASE_OWNED.map((entry) => entry.replace(/\.ndjson$/, "")),
  ];
  for (const table of await caseTables(dir)) {
    if (!owners.some((owner) => table === `${owner}.md`)) {
      problems.push(
        `cases.d/${table}: no generator or database group ${table.replace(/\.md$/, "")}`,
      );
    }
  }
  return problems;
}

/** Files a generator declares that another already claimed, or that the corpus lacks. */
function claimProblems(generators: readonly Discovered[], corpusEntries: readonly string[]) {
  const problems: string[] = [];
  const owner = new Map<string, string>();
  for (const { name, oracle } of generators) {
    for (const file of oracle.files) {
      const first = owner.get(file);
      if (first !== undefined) problems.push(`${file}: claimed by ${first} and ${name}`);
      owner.set(file, first ?? name);
      if (!corpusEntries.includes(file)) {
        problems.push(`${name}: declares ${file}, absent from fixtures/oracle`);
      }
    }
  }
  return { problems, owned: new Set(owner.keys()) };
}

/** Ways the generators and the committed fixtures disagree. Empty when every fixture has one owner. */
export function registrationProblems(
  generators: readonly Discovered[],
  corpusEntries: readonly string[],
): string[] {
  const { problems, owned } = claimProblems(generators, corpusEntries);
  const unowned = corpusEntries.filter((e) => !owned.has(e) && !DATABASE_OWNED.includes(e));
  return [...problems, ...unowned.map((entry) => `${entry}: no generator in scripts/oracle`)];
}

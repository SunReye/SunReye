import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  DATABASE_OWNED,
  type Discovered,
  discoverGenerators,
  documentationProblems,
  generatorNames,
  readCorpusEntries,
  readDocumentation,
  registrationProblems,
} from "./registry";

const REPO = new URL("../..", import.meta.url).pathname;
const SHARED = [
  "scripts/oracle/generate.ts",
  "scripts/oracle/fixtures.test.ts",
  "scripts/oracle/registry.test.ts",
  "fixtures/oracle/README.md",
];
/** Generators the repository has today: the real directory must keep them, and may hold more. */
const KNOWN = ["forecast", "plant", "profile-decode", "transport"];

let root = "";
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "oracle-registry-"));
});
afterAll(() => rm(root, { recursive: true, force: true }));

const put = async (dir: string, path: string, content: string): Promise<void> => {
  await mkdir(dirname(join(dir, path)), { recursive: true });
  await writeFile(join(dir, path), content);
};

/** The generators in `dir`, each built once: what a generator declares is what its `build` writes. */
const discover = async (dir: string): Promise<Discovered[]> => {
  const found = await discoverGenerators(dir);
  for (const { oracle } of found) {
    expect(Object.keys(await oracle.build({ profilesDir: null }))).toEqual([...oracle.files]);
  }
  return found;
};

/** What a new oracle file adds: the generator, its fixture and its case table. Nothing else. */
const addOracle = async (dir: string, name: string): Promise<void> => {
  await put(
    dir,
    `scripts/oracle/${name}.ts`,
    `export const oracle = {
  files: ["${name}.ndjson"],
  build: async () => ({ "${name}.ndjson": '{"case":"${name}/one"}\\n' }),
};
`,
  );
  await put(dir, `fixtures/oracle/${name}.ndjson`, `{"case":"${name}/one"}\n`);
  await put(
    dir,
    `fixtures/oracle/cases.d/${name}.md`,
    `## \`${name}.ndjson\`\n\n\`${name}/one\`\n`,
  );
};

/** The shared registry tests that look at the directory listing, run inside the repo `cwd`. */
const runSharedListingTests = (cwd: string): { code: number; out: string } => {
  const run = Bun.spawnSync(
    [
      process.execPath,
      "test",
      "scripts/oracle/registry.test.ts",
      "-t",
      "on the real directory|the committed corpus",
    ],
    { cwd, env: { ...process.env, SKIP_ENV_VALIDATION: "1" } },
  );
  return { code: run.exitCode, out: run.stdout.toString() + run.stderr.toString() };
};

const git = (cwd: string, ...args: string[]) => {
  const run = Bun.spawnSync(
    [
      "git",
      "-c",
      "user.name=oracle-test",
      "-c",
      "user.email=oracle-test@example.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    {
      cwd,
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
    },
  );
  return {
    code: run.exitCode,
    out: run.stdout.toString() + run.stderr.toString(),
  };
};

const commitAll = (cwd: string, message: string): void => {
  expect(git(cwd, "add", "-A").code).toBe(0);
  expect(git(cwd, "commit", "-m", message).code).toBe(0);
};

/** A repo holding the real shared files and a stub for each known generator: the base two oracle PRs branch from. */
const baseRepo = async (name: string): Promise<string> => {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  expect(git(dir, "init", "-b", "base").code).toBe(0);
  for (const path of SHARED) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await copyFile(join(REPO, path), join(dir, path));
  }
  await copyFile(join(REPO, "scripts/oracle/registry.ts"), join(dir, "scripts/oracle/registry.ts"));
  for (const known of KNOWN) await addOracle(dir, known);
  commitAll(dir, "base");
  return dir;
};

describe("two PRs that each add an oracle file", () => {
  test("pass the shared registry tests untouched, merge without a conflict and touch none of the shared files", async () => {
    const dir = await baseRepo("merge");
    for (const name of ["alpha", "beta"]) {
      expect(git(dir, "checkout", "-b", name, "base").code).toBe(0);
      await addOracle(dir, name);
      commitAll(dir, `feat: ${name} oracle`);
      expect(git(dir, "diff", "--name-only", "base", name, "--", ...SHARED).out.trim()).toBe("");
      const shared = runSharedListingTests(dir);
      expect(shared.out).toContain("0 fail");
      expect(shared.code).toBe(0);
    }
    expect(git(dir, "checkout", "alpha").code).toBe(0);
    const merged = git(dir, "merge", "--no-edit", "beta");
    expect(merged.out).not.toContain("CONFLICT");
    expect(merged.code).toBe(0);
    expect(git(dir, "diff", "--name-only", "base", "HEAD", "--", ...SHARED).out.trim()).toBe("");

    const oracleDir = join(dir, "scripts/oracle");
    expect((await discover(oracleDir)).map((g) => g.name)).toEqual(
      ["alpha", "beta", ...KNOWN].sort(),
    );
    expect(
      registrationProblems(
        await discover(oracleDir),
        await readCorpusEntries(join(dir, "fixtures/oracle")),
      ),
    ).toEqual([]);
    expect(
      await documentationProblems(join(dir, "fixtures/oracle"), await discover(oracleDir)),
    ).toEqual([]);
  });

  test("would conflict if each appended to one shared file (the harness can tell)", async () => {
    const dir = await baseRepo("conflict");
    for (const name of ["alpha", "beta"]) {
      expect(git(dir, "checkout", "-b", name, "base").code).toBe(0);
      await writeFile(
        join(dir, "fixtures/oracle/README.md"),
        (await Bun.file(join(dir, "fixtures/oracle/README.md")).text()) + `| \`${name}/one\` |\n`,
      );
      commitAll(dir, `docs: ${name} row`);
    }
    expect(git(dir, "checkout", "alpha").code).toBe(0);
    expect(git(dir, "merge", "--no-edit", "beta").out).toContain("CONFLICT");
  });
});

describe("generatorNames", () => {
  test("lists generator files, not tests or helpers", async () => {
    const dir = join(root, "names");
    for (const file of [
      "forecast.ts",
      "plant.ts",
      "corpus.ts",
      "generate.ts",
      "registry.ts",
      "forecast.test.ts",
      "notes.md",
    ]) {
      await put(dir, file, "");
    }
    expect(await generatorNames(dir)).toEqual(["forecast", "plant"]);
  });

  test("on the real directory, finds the known generators and any added since", async () => {
    expect(await generatorNames(join(REPO, "scripts/oracle"))).toEqual(
      expect.arrayContaining(KNOWN),
    );
  });
});

describe("discoverGenerators", () => {
  test("refuses a generator file that exports no `oracle`", async () => {
    const dir = join(root, "no-export");
    await put(dir, "lonely.ts", "export const x = 1;\n");
    await expect(discoverGenerators(dir)).rejects.toThrow("lonely.ts");
  });
});

describe("registrationProblems", () => {
  const setup = async (name: string): Promise<{ oracleDir: string; corpusDir: string }> => {
    const dir = join(root, name);
    await addOracle(dir, "alpha");
    await addOracle(dir, "beta");
    return { oracleDir: join(dir, "scripts/oracle"), corpusDir: join(dir, "fixtures/oracle") };
  };
  const problems = async (d: { oracleDir: string; corpusDir: string }): Promise<string[]> =>
    registrationProblems(await discover(d.oracleDir), await readCorpusEntries(d.corpusDir));

  test("registered oracles leave nothing to report; cases.d and README are not fixtures", async () => {
    const d = await setup("ok");
    await put(d.corpusDir, "README.md", "# oracle\n");
    expect(await problems(d)).toEqual([]);
  });

  test("a deleted generator leaves its fixture unowned", async () => {
    const d = await setup("deleted-generator");
    await rm(join(d.oracleDir, "beta.ts"));
    expect(await problems(d)).toEqual(["beta.ndjson: no generator in scripts/oracle"]);
  });

  test("a generator whose fixture is missing is reported", async () => {
    const d = await setup("deleted-fixture");
    await rm(join(d.corpusDir, "alpha.ndjson"));
    expect(await problems(d)).toEqual([
      "alpha: declares alpha.ndjson, absent from fixtures/oracle",
    ]);
  });

  test("two generators claiming one file are reported", async () => {
    const d = await setup("duplicate");
    await put(
      join(d.oracleDir, ".."),
      "oracle/gamma.ts",
      `export const oracle = { files: ["alpha.ndjson"], build: async () => ({ "alpha.ndjson": "" }) };\n`,
    );
    expect(await problems(d)).toEqual(["alpha.ndjson: claimed by alpha and gamma"]);
  });

  test("a database-owned fixture needs no generator here", async () => {
    const d = await setup("db-owned");
    for (const entry of DATABASE_OWNED) await put(d.corpusDir, `${entry}/x`, "");
    expect(await problems(d)).toEqual([]);
  });

  test("a stray directory is an unowned entry", async () => {
    const d = await setup("segments");
    await put(d.corpusDir, "stray/deep/file.json", "{}");
    expect(await problems(d)).toEqual(["stray: no generator in scripts/oracle"]);
  });
});

describe("documentationProblems", () => {
  const setup = async (name: string): Promise<{ oracleDir: string; corpusDir: string }> => {
    const dir = join(root, name);
    await addOracle(dir, "alpha");
    await addOracle(dir, "beta");
    await put(join(dir, "fixtures/oracle"), "README.md", "# oracle\n");
    return { oracleDir: join(dir, "scripts/oracle"), corpusDir: join(dir, "fixtures/oracle") };
  };
  const problems = async (d: { oracleDir: string; corpusDir: string }): Promise<string[]> =>
    documentationProblems(d.corpusDir, await discover(d.oracleDir));

  test("cases documented in their own fragment leave nothing to report", async () => {
    expect(await problems(await setup("doc-ok"))).toEqual([]);
  });

  test("a deleted fragment leaves its generator's cases undocumented", async () => {
    const d = await setup("doc-deleted");
    await rm(join(d.corpusDir, "cases.d/alpha.md"));
    expect(await problems(d)).toEqual([
      "alpha.ndjson: `alpha/one` is in neither README.md nor cases.d/",
    ]);
  });

  test("the README documents a case as well as a fragment does", async () => {
    const d = await setup("doc-readme");
    await rm(join(d.corpusDir, "cases.d/alpha.md"));
    await put(d.corpusDir, "README.md", "# oracle\n\n`alpha/one`\n");
    expect(await problems(d)).toEqual([]);
  });

  test("a fragment no generator owns is reported", async () => {
    const d = await setup("doc-orphan");
    await put(d.corpusDir, "cases.d/gamma.md", "`gamma/one`\n");
    expect(await problems(d)).toEqual(["cases.d/gamma.md: no generator or database group gamma"]);
  });

  test("a fragment may document a database group, by its file stem", async () => {
    const d = await setup("doc-database");
    await put(d.corpusDir, "rollups.ndjson", '{"case":"rollups/one"}\n');
    await put(d.corpusDir, "archives/legacy/archive.tar.gz", "");
    expect(await problems(d)).toEqual([
      "rollups.ndjson: `rollups/one` is in neither README.md nor cases.d/",
      "archives: `legacy` is in neither README.md nor cases.d/",
    ]);
    await put(d.corpusDir, "cases.d/rollups.md", "`rollups/one`\n");
    await put(d.corpusDir, "cases.d/archives.md", "`legacy`\n");
    expect(await problems(d)).toEqual([]);
  });

  test("a profile line is named by its profile id, and a line with no name is not a case", async () => {
    const d = await setup("doc-profile");
    await put(
      d.corpusDir,
      "alpha.ndjson",
      '{"profile":{"id":"deye-x"}}\n{"pv.power":"per-device"}\n',
    );
    expect(await problems(d)).toEqual([
      "alpha.ndjson: `deye-x` is in neither README.md nor cases.d/",
    ]);
  });
});

describe("readDocumentation", () => {
  test("joins the README with every case table, and needs no cases.d", async () => {
    const dir = join(root, "docs");
    await put(dir, "README.md", "intro `a/one`\n");
    expect(await readDocumentation(dir)).toContain("`a/one`");
    await put(dir, "cases.d/beta.md", "`b/one`\n");
    await put(dir, "cases.d/alpha.md", "`c/one`\n");
    expect(await readDocumentation(dir)).toBe("intro `a/one`\n\n`c/one`\n\n`b/one`\n");
  });
});

describe("the committed corpus", () => {
  test("every fixture has a generator or is database-owned, and every generator has its fixtures", async () => {
    const oracleDir = join(REPO, "scripts/oracle");
    const corpusDir = join(REPO, "fixtures/oracle");
    expect(
      registrationProblems(await discoverGenerators(oracleDir), await readCorpusEntries(corpusDir)),
    ).toEqual([]);
  });
});

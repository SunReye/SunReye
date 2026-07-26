/**
 * Command implementations for the `profile` CLI, separated from the argv
 * dispatch in ./cli so they can be unit-tested (the dispatch runs at import).
 * Failure paths print to stderr and `process.exit(1)` — same contract the CLI
 * always had; tests stub `process.exit`.
 */

import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  coverage,
  groupByPrefix,
  isIndexedRole,
  suggestAggregates,
  type AggregateSuggestion,
} from "./coverage";
import {
  aiGuideFiles,
  planUpgrade,
  scaffoldProject,
  titleFromId,
  type InitOptions,
  type UpgradeAction,
  type UpgradeStatus,
} from "./init";
import {
  buildRepo,
  type RepoBuildResult,
  type RepoEntryInput,
  type VersionDecision,
  type VersionStatus,
} from "./repo";
import { scaffoldFromCsv } from "./scaffold";
import { validateProfile } from "./validate";
import pkg from "../package.json";
import type { BumpLevel, CanonicalRole, ProfileData } from "@SunReye/inverter-core";

async function readJson(path: string): Promise<unknown> {
  const file = Bun.file(path);
  if (!(await file.exists())) fail(`file not found: ${path}`);
  return JSON.parse(await file.text());
}

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

/** Report a header plus one bullet per issue on stderr, then exit 1. */
function failIssues(header: string, issues: readonly string[]): never {
  console.error(header);
  for (const issue of issues) console.error(`  • ${issue}`);
  process.exit(1);
}

/** Write a `{ relativePath: contents }` map under `dir`. */
async function writeFiles(dir: string, files: Record<string, string>): Promise<void> {
  for (const [rel, contents] of Object.entries(files)) await Bun.write(join(dir, rel), contents);
}

/** Parse `--flag value` pairs from the tail args. */
export function flags(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) out[a.slice(2)] = args[++i] ?? "";
  }
  return out;
}

export async function cmdValidate(path: string | undefined): Promise<void> {
  if (!path) fail("usage: profile validate <file>");
  const { ok, issues } = validateProfile(await readJson(path));
  if (!ok) failIssues(`✗ ${path} is invalid:`, issues);
  console.log(`✓ ${path} is a valid profile`);
}

/** Print the unmapped-role section of a coverage report, grouped by role prefix. */
function printMissingRoles(missing: CanonicalRole[]): void {
  if (missing.length === 0) {
    console.log("✓ every renderable role is mapped");
    return;
  }
  console.log("Unmapped roles (these UI areas render empty):");
  for (const [prefix, roles] of groupByPrefix(missing)) {
    const list = roles.map((r) => (isIndexedRole(r) ? `${r}[]` : r)).join(", ");
    console.log(`  ${prefix}: ${list}`);
  }
}

/** Print the `sumOf` suggestions for hand-listed sums, when there are any. */
function printAggregateHints(hints: readonly AggregateSuggestion[]): void {
  if (hints.length === 0) return;
  console.log("\nOptimization hints:");
  for (const h of hints) {
    console.log(
      `  • "${h.key}" sums every ${h.role} (${h.count} metrics) — consider ` +
        `sumOf({ role: "${h.role}" }) so model variants self-heal.`,
    );
  }
}

export async function cmdCoverage(path: string | undefined): Promise<void> {
  if (!path) fail("usage: profile coverage <file>");
  const data = await readJson(path);
  const { ok, issues } = validateProfile(data);
  if (!ok) failIssues("✗ profile is invalid — fix validation first:", issues);

  const report = coverage(data as ProfileData);
  console.log(`Role coverage: ${report.mappedCount}/${report.total} canonical roles mapped\n`);
  printMissingRoles(report.missing);
  printAggregateHints(suggestAggregates(data as ProfileData));
}

/** Current contents of every managed AI-guide file under `targetDir` (`null` when absent). */
async function readExistingGuides(targetDir: string): Promise<Record<string, string | null>> {
  const existing: Record<string, string | null> = {};
  for (const f of aiGuideFiles()) {
    const file = Bun.file(join(targetDir, f.path));
    existing[f.path] = (await file.exists()) ? await file.text() : null;
  }
  return existing;
}

/** Persist the writes an upgrade plan asks for; `write: null` means "leave it alone". */
async function applyUpgradePlan(targetDir: string, plan: readonly UpgradeAction[]): Promise<void> {
  for (const action of plan) {
    if (action.write !== null) await Bun.write(join(targetDir, action.path), action.write);
  }
}

/** Print the per-file upgrade outcome, plus the follow-up hints the statuses imply. */
function reportUpgrade(targetDir: string, plan: readonly UpgradeAction[]): void {
  const mark: Record<UpgradeStatus, string> = {
    created: "＋ created",
    updated: "↻ updated",
    unchanged: "✓ up to date",
    diverged: "⚠ kept your edited copy",
    manual: "⚠ needs a manual edit",
  };
  console.log(`AI authoring guide in ${targetDir}:`);
  for (const action of plan) console.log(`  ${mark[action.status]} — ${action.path}`);

  if (plan.some((a) => a.status === "diverged")) {
    console.log(
      "\nA managed file has local edits and was left as-is — re-run with --force to overwrite.",
    );
  }
  if (plan.some((a) => a.status === "manual")) {
    console.log("\nAdd `@AGENTS.md` to the top of your CLAUDE.md so Claude Code reads the guide.");
  }
}

/**
 * Refresh the cross-tool AI authoring guide ({@link aiGuideFiles}) in an
 * existing project — the upgrade path for repos scaffolded before it existed.
 * Managed files with local edits are kept unless `--force`; a `CLAUDE.md` that
 * lacks the `@AGENTS.md` import is flagged rather than clobbered.
 */
export async function cmdUpgrade(
  dir: string | undefined,
  opts: Record<string, string>,
): Promise<void> {
  const targetDir = resolve(dir ?? ".");
  if (!existsSync(join(targetDir, "package.json"))) {
    fail(
      `${targetDir} has no package.json — run this inside a profile-authoring project ` +
        `(or 'profile init' to create one)`,
    );
  }
  const force = "force" in opts && opts.force !== "false";

  const plan = planUpgrade(await readExistingGuides(targetDir), force);
  await applyUpgradePlan(targetDir, plan);
  reportUpgrade(targetDir, plan);
}

export async function cmdScaffold(
  path: string | undefined,
  opts: Record<string, string>,
): Promise<void> {
  if (!path) fail("usage: profile scaffold <csv> --id <id> --name <name> --manufacturer <m>");
  if (!opts.id || !opts.name || !opts.manufacturer) {
    fail("scaffold requires --id, --name, and --manufacturer");
  }
  const csv = await Bun.file(path).text();
  const data = scaffoldFromCsv(csv, {
    id: opts.id,
    name: opts.name,
    manufacturer: opts.manufacturer,
    version: opts.version ?? "0.1.0",
  });
  // Emit to stdout so it can be piped to a file and hand-edited (add roles).
  console.log(JSON.stringify(data, null, 2));
}

/**
 * Loose shape check used to pick profile exports out of a module — full
 * validation happens in `buildRepo`, so a broken profile is reported as a
 * validation error instead of silently skipped here.
 */
function isProfileLike(value: unknown): value is ProfileData {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as ProfileData).schemaVersion === 1 &&
    typeof (value as ProfileData).id === "string" &&
    Array.isArray((value as ProfileData).metrics)
  );
}

/**
 * Collect profiles from one entry file: a `.json` file is a single serialized
 * profile; anything else is imported as a module and every export (including
 * array elements and `{ profile, description }` wrappers) that looks like a
 * profile is taken.
 */
async function loadEntry(path: string): Promise<RepoEntryInput[]> {
  if (path.endsWith(".json")) {
    return [{ profile: (await readJson(path)) as ProfileData }];
  }
  const mod: Record<string, unknown> = await import(pathToFileURL(resolve(path)).href);
  const found: RepoEntryInput[] = [];
  // Dedupe by identity: `export const x` + `export default x` is one profile.
  const taken = new Set<unknown>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== "object" || value === null || taken.has(value)) return;
    if (isProfileLike(value)) {
      taken.add(value);
      found.push({ profile: value });
      return;
    }
    const wrapper = value as Partial<RepoEntryInput>;
    if (isProfileLike(wrapper.profile) && !taken.has(wrapper.profile)) {
      taken.add(wrapper.profile);
      found.push({ profile: wrapper.profile, description: wrapper.description });
    }
  };
  for (const value of Object.values(mod)) visit(value);
  if (found.length === 0) fail(`no profiles exported from ${path}`);
  return found;
}

/**
 * Read the previously built `profiles/*.json` under `out` (keyed by id) so the
 * build can version change-aware. Malformed or non-profile files are skipped —
 * a broken prior file just means that profile looks "new".
 */
async function loadPreviousBuild(out: string): Promise<Map<string, ProfileData>> {
  const previous = new Map<string, ProfileData>();
  const dir = join(out, "profiles");
  if (!existsSync(dir)) return previous;
  for (const name of await readdir(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(await Bun.file(join(dir, name)).text());
      if (isProfileLike(parsed)) previous.set(parsed.id, parsed);
    } catch {
      // Skip unreadable/invalid prior file — treated as no previous version.
    }
  }
  return previous;
}

const VERSION_MARK: Record<VersionStatus, string> = {
  new: "new",
  unchanged: "unchanged",
  "auto-bumped": "bumped",
  "author-bumped": "bumped by author",
};

/** Validate the optional `--bump` flag, failing with a usage error if invalid. */
function parseBumpLevel(raw: string | undefined): BumpLevel | undefined {
  if (raw === undefined) return undefined;
  if (raw !== "patch" && raw !== "minor" && raw !== "major") {
    fail(`invalid --bump "${raw}" (expected patch, minor, or major)`);
  }
  return raw;
}

/** Human-readable "(bumped from x.y.z)" suffix for a build's version decision. */
function versionNote(decision: VersionDecision | undefined, version: string): string {
  if (!decision) return "";
  const mark = VERSION_MARK[decision.status];
  if (decision.previousVersion && decision.previousVersion !== version) {
    return ` (${mark} from ${decision.previousVersion})`;
  }
  return ` (${mark})`;
}

/** Print the build summary line + one line per profile with its version note. */
function reportBuild(result: RepoBuildResult, out: string): void {
  const bumped = result.versioning.filter((v) => v.status === "auto-bumped").length;
  console.log(
    `✓ wrote ${result.index.profiles.length} profile(s) + index.json to ${out}` +
      (bumped > 0 ? ` (${bumped} auto-bumped)` : ""),
  );
  const byId = new Map(result.versioning.map((v) => [v.id, v]));
  for (const entry of result.index.profiles) {
    const note = versionNote(byId.get(entry.id), entry.version);
    console.log(`  • ${entry.id}@${entry.version} → ${entry.path}${note}`);
  }
}

export async function cmdBuild(paths: string[], opts: Record<string, string>): Promise<void> {
  if (paths.length === 0) {
    fail(
      "usage: profile build <module.ts|profile.json ...> --out <dir> [--name n] [--maintainer m] [--bump patch|minor|major]",
    );
  }
  const out = opts.out;
  if (!out) fail("build requires --out <dir>");

  const bump = parseBumpLevel(opts.bump);

  const entries: RepoEntryInput[] = [];
  for (const path of paths) entries.push(...(await loadEntry(path)));

  const previous = await loadPreviousBuild(out);
  const result = buildRepo(entries, {
    name: opts.name,
    maintainer: opts.maintainer,
    previous,
    bump,
  });
  if (!result.ok) failIssues("✗ repo build failed:", result.issues);

  await writeFiles(out, result.files);
  reportBuild(result, out);
}

/** Interactive I/O for `cmdInit`, injectable so the command body stays testable. */
export interface InitDeps {
  /** Ask a free-text question; return the default when the answer is blank. */
  prompt?: (message: string, def?: string) => string;
  /** Ask a yes/no question with a default when the answer is blank. */
  confirm?: (message: string, def: boolean) => boolean;
  /** Run a child process in `cwd`; resolve to whether it exited 0. */
  run?: (command: string[], cwd: string) => Promise<boolean>;
  /** SDK version to depend on (defaults to this package's version). */
  sdkVersion?: string;
}

const defaultPrompt = (message: string, def?: string): string => {
  const answer = prompt(def ? `${message} (${def})` : message);
  return (answer ?? "").trim() || (def ?? "");
};

const defaultConfirm = (message: string, def: boolean): boolean => {
  const answer = (prompt(`${message} (${def ? "Y/n" : "y/N"})`) ?? "").trim().toLowerCase();
  if (answer === "") return def;
  return answer === "y" || answer === "yes";
};

const defaultRun = async (command: string[], cwd: string): Promise<boolean> => {
  const proc = Bun.spawn(command, { cwd, stdout: "inherit", stderr: "inherit" });
  return (await proc.exited) === 0;
};

/**
 * Gather {@link InitOptions} from `--flags`, falling back to interactive prompts
 * (or, under `--yes`, to the shown defaults without asking).
 */
function gatherInitOptions(
  targetDir: string,
  opts: Record<string, string>,
  ask: NonNullable<InitDeps["prompt"]>,
  sdkVersion: string,
): InitOptions {
  const yes = "yes" in opts;
  const field = (flag: string, message: string, def: string): string => {
    if (opts[flag]) return opts[flag]!;
    return yes ? def : ask(message, def) || def;
  };

  const packageName = field("pkg", "Package name", basename(targetDir) || "sunreye-profiles");
  const id = field("id", "First profile id", "my-inverter");
  return {
    packageName,
    repoName: field("repo-name", "Profile repo display name", packageName),
    maintainer: (opts.maintainer ?? (yes ? "" : ask("Maintainer (optional)", ""))) || undefined,
    profile: {
      id,
      name: field("profile-name", "First profile display name", titleFromId(id)),
      manufacturer: field("manufacturer", "Manufacturer", "Acme"),
    },
    sdkVersion,
  };
}

/** Run one optional post-scaffold step (`bun install` / `git init`), logging the outcome. */
async function runStep(
  enabled: boolean,
  command: string[],
  cwd: string,
  run: NonNullable<InitDeps["run"]>,
  { start, ok, fail: failMsg }: { start: string; ok: string; fail: string },
): Promise<void> {
  if (!enabled) return;
  console.log(start);
  console.log((await run(command, cwd)) ? ok : failMsg);
}

/**
 * Whether an optional post-scaffold step runs: `--<flag>` forces the choice (any
 * value but `"false"`), `--yes` skips it, otherwise ask with a default of yes.
 */
function decideStep(
  flag: string,
  message: string,
  opts: Record<string, string>,
  confirmFn: NonNullable<InitDeps["confirm"]>,
): boolean {
  if (flag in opts) return opts[flag] !== "false";
  if ("yes" in opts) return false;
  return confirmFn(message, true);
}

/** Run the optional `bun install` / `git init` steps after a successful scaffold. */
async function runPostInitSteps(
  targetDir: string,
  opts: Record<string, string>,
  deps: InitDeps,
): Promise<void> {
  const confirmFn = deps.confirm ?? defaultConfirm;
  const run = deps.run ?? defaultRun;

  await runStep(
    decideStep("install", "Install dependencies with bun now?", opts, confirmFn),
    ["bun", "install"],
    targetDir,
    run,
    {
      start: "\nInstalling dependencies (bun install)…",
      ok: "✓ dependencies installed",
      fail: "⚠ bun install failed — run it yourself",
    },
  );

  const wantGit = decideStep("git", "Initialize a git repository?", opts, confirmFn);
  if (wantGit && existsSync(join(targetDir, ".git"))) {
    console.log("• git repository already initialized — skipping");
    return;
  }
  await runStep(wantGit, ["git", "init"], targetDir, run, {
    start: "\nInitializing git repository (git init)…",
    ok: "✓ git repository initialized",
    fail: "⚠ git init failed",
  });
}

/**
 * Scaffold a new profile-authoring project. Values come from `--flags` when
 * given, otherwise from interactive prompts; then it optionally runs
 * `bun install` and `git init`. Non-interactive when `--yes` is set (missing
 * values fall back to defaults and the install/git prompts are skipped unless
 * their flags force them on).
 */
export async function cmdInit(
  dir: string | undefined,
  opts: Record<string, string>,
  deps: InitDeps = {},
): Promise<void> {
  const targetDir = resolve(dir ?? ".");
  if (existsSync(join(targetDir, "package.json"))) {
    fail(`${targetDir} already contains a package.json — refusing to overwrite`);
  }

  const files = scaffoldProject(
    gatherInitOptions(
      targetDir,
      opts,
      deps.prompt ?? defaultPrompt,
      deps.sdkVersion ?? pkg.version,
    ),
  );
  await writeFiles(targetDir, files);
  console.log(`✓ scaffolded profile project in ${targetDir}`);
  for (const rel of Object.keys(files).sort()) console.log(`  • ${rel}`);

  await runPostInitSteps(targetDir, opts, deps);
  console.log(`\nNext: cd ${dir ?? "."} && bun run build`);
}

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
  missingRequiredRoles,
  parseRequiredRoles,
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
import { captureSchema, replayCapture, type Capture, type ReplayResult } from "./replay";
import { lintProfile, validateProfile } from "./validate";
import pkg from "../package.json";
import { hydrateProfile, parseProfileData } from "@SunReye/inverter-core";
import type {
  BumpLevel,
  CanonicalRole,
  InverterProfile,
  ProfileData,
} from "@SunReye/inverter-core";

async function readJson(path: string): Promise<unknown> {
  const file = Bun.file(path);
  if (!(await file.exists())) fail(`file not found: ${path}`);
  const text = await file.text();
  try {
    return JSON.parse(text);
  } catch (error) {
    // A truncated or hand-mangled file is a user error, not a crash: keep the
    // `error: …` + exit 1 contract instead of dumping a parser stack trace.
    fail(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
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

/**
 * Strict validation plus the semantic lints. Lint findings are warnings by
 * default and a hard failure under `--strict`, so the same command can advise
 * an author and gate a CI run.
 */
export async function cmdValidate(
  path: string | undefined,
  opts: Record<string, string> = {},
): Promise<void> {
  if (!path) fail("usage: profile validate <file>");
  const data = await readJson(path);
  const { ok, issues } = validateProfile(data);
  if (!ok) failIssues(`✗ ${path} is invalid:`, issues);

  const profile = data as ProfileData;
  const warnings = lintProfile(profile);
  if (warnings.length > 0 && "strict" in opts) {
    failIssues(`✗ ${path} failed ${warnings.length} lint(s):`, warnings);
  }
  console.log(`✓ ${path} is a valid profile`);
  if (warnings.length > 0) {
    console.log(`\n⚠ ${warnings.length} lint warning(s) — re-run with --strict to gate on them:`);
    for (const w of warnings) console.log(`  • ${w}`);
  }
  // Coverage advice is never a gate — an inverter without a generator is not a
  // broken profile — so it prints after the lints and does not affect the exit.
  const report = coverage(profile);
  if (report.missing.length > 0) {
    console.log("");
    printMissingRoles(report.missing);
  }
  printAggregateHints(suggestAggregates(profile));
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

/**
 * Refuse to publish a profile that leaves a required renderable role unmapped —
 * the section it feeds would render empty on every dashboard. The floor is
 * `--require a,b` when given, otherwise the per-family anchors
 * ({@link FAMILY_ANCHOR_ROLES}), so a machine without a battery is never asked
 * for `battery.soc`. Every refusal names the profile and the missing role(s).
 */
function enforceRoleFloor(entries: readonly RepoEntryInput[], require: string | undefined): void {
  const { roles, unknown } = parseRequiredRoles(require);
  if (unknown.length > 0) {
    fail(`--require lists unknown role(s): ${unknown.join(", ")}`);
  }
  const issues: string[] = [];
  for (const entry of entries) {
    const missing = missingRequiredRoles(entry.profile, roles);
    if (missing.length > 0) {
      issues.push(`${entry.profile.id}: missing required role(s) ${missing.join(", ")}`);
    }
  }
  if (issues.length > 0) {
    failIssues("✗ repo build failed — required roles are unmapped:", issues);
  }
}

export async function cmdBuild(paths: string[], opts: Record<string, string>): Promise<void> {
  if (paths.length === 0) {
    fail(
      "usage: profile build <module.ts|profile.json ...> --out <dir> [--name n] [--maintainer m] [--bump patch|minor|major] [--require role,role]",
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

  enforceRoleFloor(entries, opts.require);
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

/**
 * `profile replay <capture.json...>` — run golden register captures through the
 * real decode path and diff against their expectations.
 *
 * This is the only authoring check that can prove a value is *correct* rather
 * than merely present: `exerciseProfile()` drives the generic simulator, so it
 * shows every metric produces a number and can never show the number is right.
 * A capture taken from a real device is therefore the regression test for the
 * highest-risk profile edit there is — a changed `scale`, `offset` or address.
 *
 * Exit 1 if any capture fails, so it is usable as a CI gate next to the profile.
 */
/**
 * The profile a capture is replayed against. An explicit `--profile` is what a
 * profile repo uses: the profile under test is a file in the working tree, not
 * something installed in this process. Absent, `replayCapture` resolves the
 * capture's own id from the registry.
 */
async function replayProfile(path: string | undefined): Promise<InverterProfile | undefined> {
  if (!path) return undefined;
  const data = await readJson(path);
  const { ok, issues } = validateProfile(data);
  if (!ok) failIssues(`✗ ${path} is invalid:`, issues);
  return hydrateProfile(parseProfileData(data));
}

/** Read and validate one capture file, failing readably rather than throwing. */
async function readCapture(path: string): Promise<Capture> {
  try {
    return captureSchema.parse(JSON.parse(await Bun.file(path).text()));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    fail(`invalid capture file ${path}: ${message}`);
  }
}

/** Print one capture's outcome. Returns whether it failed. */
function reportReplay(path: string, r: ReplayResult): boolean {
  if (r.ok) {
    const keys = r.matched.map((m) => m.key).join(", ");
    console.log(`✓ ${path} — ${r.expectationCount} expectation(s) matched: ${keys}`);
  } else {
    console.error(`✗ ${path}`);
    for (const m of r.mismatched) {
      console.error(`  • ${m.key}: expected ${m.expected}, got ${m.actual}`);
    }
    for (const e of r.errors) console.error(`  • ${e}`);
  }
  // Informational either way: a capture may legitimately cover a subset of the
  // profile's registers, and after #63 an unanswered address decodes to
  // `undefined` rather than 0 — worth surfacing so it is not mistaken for one.
  for (const miss of r.missingRegisters) {
    console.error(`  ⚠ ${miss.key}: no value — registers absent: ${miss.missing.join(", ")}`);
  }
  return !r.ok;
}

export async function cmdReplay(paths: string[], opts: Record<string, string> = {}): Promise<void> {
  if (paths.length === 0) {
    fail("usage: profile replay <capture.json...> [--profile <file>] [--json]");
  }

  const profile = await replayProfile(opts.profile);
  const results: ReplayResult[] = [];
  for (const path of paths) results.push(replayCapture(await readCapture(path), profile));

  if ("json" in opts) console.log(JSON.stringify(results, null, 2));

  const failed = results.filter((r, i) => reportReplay(paths[i]!, r)).length;
  if (failed > 0) fail(`${failed} of ${results.length} capture(s) failed`);
}

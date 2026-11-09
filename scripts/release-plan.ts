// What `bun run release` cuts (ADR 13): the version the manifests name, checked against semver
// and the conventional commits since the last release, and the changelog of those commits.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { git, tryGit } from "./git.ts";

export interface Plan {
  /** `major.minor.patch`. */
  readonly version: string;
  /** The git tag that names the release. */
  readonly tag: string;
  /** The changelog section, Markdown. */
  readonly notes: string;
}

interface Commit {
  readonly type: string;
  readonly scope: string | undefined;
  readonly summary: string;
  readonly breaking: boolean;
}

const headline = /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<bang>!)?: (?<summary>.+)$/u;

/** A conventional commit, or `undefined` for any other message. */
function parse(message: string): Commit | undefined {
  const [subject = "", ...body] = message.split("\n");
  const groups = headline.exec(subject)?.groups;

  if (groups?.["type"] === undefined || groups["summary"] === undefined) return undefined;

  return {
    type: groups["type"],
    scope: groups["scope"],
    summary: groups["summary"],
    breaking: groups["bang"] === "!" || body.some((text) => text.startsWith("BREAKING CHANGE:")),
  };
}

const record = "\u001E";

/** The conventional commits in `range`, newest first; merges and other messages are skipped. */
function commits(repo: string, range: readonly string[]): Commit[] {
  const log = git(repo, ["log", "--no-merges", `--format=%B${record}`, ...range]);

  return log.split(record).flatMap((message) => parse(message.trim()) ?? []);
}

/** The last release's tag reachable from HEAD, or `undefined` before the first release. */
function lastTag(repo: string): string | undefined {
  const described = tryGit(repo, ["describe", "--tags", "--abbrev=0", "--match", "v*.*.*"]);

  return described.exitCode === 0 ? described.stdout.toString().trim() : undefined;
}

const sections: readonly (readonly [title: string, keep: (commit: Commit) => boolean])[] = [
  ["Breaking changes", (commit) => commit.breaking],
  ["Features", (commit) => commit.type === "feat"],
  ["Fixes", (commit) => commit.type === "fix"],
  ["Performance", (commit) => commit.type === "perf"],
];

function line(commit: Commit): string {
  return commit.scope === undefined
    ? `- ${commit.summary}`
    : `- **${commit.scope}:** ${commit.summary}`;
}

function changelog(version: string, date: string, listed: readonly Commit[]): string {
  const body = sections.flatMap(([title, keep]) => {
    const lines = listed.flatMap((commit) => (keep(commit) ? [line(commit)] : []));

    return lines.length === 0 ? [] : [`### ${title}`, "", lines.join("\n"), ""];
  });

  return [`## ${version} (${date})`, "", ...body].join("\n");
}

/** The version `[workspace.package]` in Cargo.toml names. */
async function cargoVersion(repo: string): Promise<string> {
  const toml = await readFile(join(repo, "Cargo.toml"), "utf8");
  const workspace = /\[workspace\.package\][^[]*?^version = "(?<v>[^"]+)"/mu;
  const version = workspace.exec(toml)?.groups?.["v"];

  if (version === undefined) throw new Error("Cargo.toml names no [workspace.package] version");

  return version;
}

/** The version the add-on manifest names. */
async function addonVersion(repo: string): Promise<string | undefined> {
  const yaml = await readFile(join(repo, "packaging/addon/config.yaml"), "utf8");

  return /^version: (?<v>\S+)$/mu.exec(yaml)?.groups?.["v"];
}

function semver(version: string): readonly [number, number, number] {
  const [major = 0, minor = 0, patch = 0] = version.split(".").map(Number);

  return [major, minor, patch];
}

/** The least version that releases `listed` after `last`, or `undefined` when none must. */
function least(last: string, listed: readonly Commit[]): string | undefined {
  const [major, minor, patch] = semver(last.slice(1));

  if (listed.some((commit) => commit.breaking)) return `${major + 1}.0.0`;

  if (listed.some((commit) => commit.type === "feat")) return `${major}.${minor + 1}.0`;

  if (listed.some((commit) => commit.type === "fix" || commit.type === "perf")) {
    return `${major}.${minor}.${patch + 1}`;
  }

  return undefined;
}

/** Whether `a` is a lower semver than `b`: numeric collation orders each dotted part as a number. */
function below(a: string, b: string): boolean {
  return a.localeCompare(b, "en", { numeric: true }) < 0;
}

/** Refuses a version the commits since `last` do not allow. */
function checkSemver(version: string, last: string, listed: readonly Commit[]): void {
  const needed = least(last, listed);

  if (needed === undefined) {
    throw new Error(`nothing to release: no feature, fix or performance commit since ${last}`);
  }

  if (below(version, needed)) {
    throw new Error(
      `the commits since ${last} need version ${needed} or above; Cargo.toml names ${version}`,
    );
  }
}

/** Refuses a checkout the release could not reproduce from its commit. */
async function checkCheckout(repo: string, version: string): Promise<void> {
  if (git(repo, ["status", "--porcelain"]) !== "") {
    throw new Error("the checkout has uncommitted changes: commit them first");
  }

  const addon = await addonVersion(repo);

  if (addon !== version) {
    throw new Error(
      `packaging/addon/config.yaml names version ${addon ?? "none"}; Cargo.toml names ${version}`,
    );
  }
}

/** Plans the release HEAD would cut. */
export async function planRelease(repo: string): Promise<Plan> {
  const version = await cargoVersion(repo);

  await checkCheckout(repo, version);

  const last = lastTag(repo);
  const listed = commits(repo, last === undefined ? ["HEAD"] : [`${last}..HEAD`]);

  if (last !== undefined) checkSemver(version, last, listed);

  const date = git(repo, ["log", "-1", "--format=%as"]).trim();

  return { version, tag: `v${version}`, notes: changelog(version, date, listed) };
}

#!/usr/bin/env node
// Write sunreye-beta/CHANGELOG.md — the Changelog tab of the beta addon in Home
// Assistant, so a beta says what it contains instead of appearing as an opaque
// version bump.
//
// Structure: an `[unreleased]` section built from the conventional commits on
// `dev` since the last addon release, followed verbatim by the released history
// in sunreye/CHANGELOG.md. evcc rebuilds that history from the GitHub Releases
// API (evcc-io/evcc .github/workflows/hassio-changelog.yml); we already keep a
// curated addon changelog, so we prepend to it rather than re-deriving it.
//
// The unreleased bullets are rendered the way release-please renders them —
// same section names, same order, same `* **scope:** subject (sha)` shape — so a
// beta entry reads exactly like the release entry it eventually becomes.
//
// Usage:
//   node scripts/beta-changelog.mjs --version=beta.20260814-3b95b3a [--head=<sha>]
//
// --head is the commit the beta was built from (github.sha on `dev`); it
// defaults to HEAD. Needs tags and history — the workflow checks out with
// fetch-depth: 0.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BREAKING_CATEGORY, categoryRank, TYPE_TO_CATEGORY } from "./lib/changelog-categories.mjs";

const ROOT = process.cwd();
const RELEASED = join(ROOT, "sunreye/CHANGELOG.md");
const BETA = join(ROOT, "sunreye-beta/CHANGELOG.md");
const REPO_URL = "https://github.com/SunReye/SunReye";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

const arg = (name) =>
  process.argv
    .slice(2)
    .find((a) => a.startsWith(`--${name}=`))
    ?.slice(name.length + 3);

/** Newest `addon-v*` tag as { tag, version }, or null when the repo has none. */
function lastReleaseTag() {
  const versions = git("tag", "-l", "addon-v*")
    .split("\n")
    .map((t) => t.match(/^addon-v(\d+)\.(\d+)\.(\d+)$/))
    .filter(Boolean)
    .map((m) => [Number(m[1]), Number(m[2]), Number(m[3])])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);

  const newest = versions.at(-1);
  return newest ? { tag: `addon-v${newest.join(".")}`, version: newest.join(".") } : null;
}

// Commits that describe release plumbing rather than product change. The
// addon-beta publish commits in particular would otherwise accumulate one
// meaningless bullet per beta build.
const NOISE = /^chore\((?:addon|addon-beta)\): publish |^chore: release /;

const SUBJECT = /^(?<type>\w+)(?:\((?<scope>[^)]*)\))?(?<breaking>!)?: (?<summary>.+)$/;

/** `* **scope:** summary ([sha](commit url))`, as release-please renders it. */
function formatBullet(groups, sha) {
  const scope = groups.scope ? `**${groups.scope}:** ` : "";
  return `* ${scope}${groups.summary} ([${sha.slice(0, 7)}](${REPO_URL}/commit/${sha}))`;
}

/** Bullet descriptor for a conventional subject, or null when it has no section. */
function describe(subject, sha) {
  // Non-conventional subjects, and types absent from the map, are dropped —
  // same as release-please.
  const groups = subject.match(SUBJECT)?.groups;
  if (!groups) return null;

  const category = TYPE_TO_CATEGORY.get(groups.type);
  if (!category) return null;

  return { category, breaking: Boolean(groups.breaking), bullet: formatBullet(groups, sha) };
}

/** Parse one `<sha>\x1f<subject>` line into a bullet descriptor, or null to drop it. */
function parseCommit(line) {
  const [sha, subject] = line.split("\x1f");
  if (!subject || NOISE.test(subject)) return null;
  return describe(subject, sha);
}

/** Group bullets by section heading, listing breaking changes twice as release-please does. */
function groupBullets(commits) {
  const sections = new Map();
  const push = (category, bullet) => {
    const bullets = sections.get(category) ?? [];
    bullets.push(bullet);
    sections.set(category, bullets);
  };

  for (const { category, breaking, bullet } of commits) {
    if (breaking) push(BREAKING_CATEGORY, bullet);
    push(category, bullet);
  }
  return sections;
}

function renderUnreleased(sections, version, since) {
  const headline = since
    ? `Unreleased work on \`dev\` since ${since}, shipped in \`${version}\`.`
    : `Unreleased work on \`dev\`, shipped in \`${version}\`.`;

  const lines = ["## [unreleased]", "", headline];
  for (const category of [...sections.keys()].sort((a, b) => categoryRank(a) - categoryRank(b))) {
    lines.push("", "", `### ${category}`, "");
    lines.push(...sections.get(category));
  }
  return lines;
}

const version = arg("version");
if (!version) {
  console.error("beta-changelog: --version=<beta version> is required");
  process.exit(1);
}

const head = arg("head") ?? "HEAD";
const release = lastReleaseTag();

// Without a tag there is no range to describe, so fall back to the released
// history alone rather than dumping the repo's entire history into the tab.
const log = release
  ? git("log", "--no-merges", "--format=%H%x1f%s", `${release.tag}..${head}`)
  : "";
const commits = log ? log.split("\n").map(parseCommit).filter(Boolean) : [];

// Released history, minus its own "# Changelog" title (this file supplies one).
const released = readFileSync(RELEASED, "utf8").replace(/^# Changelog\n+/, "");

const parts = ["# Changelog", ""];
if (commits.length > 0) {
  parts.push(...renderUnreleased(groupBullets(commits), version, release?.version), "");
} else {
  parts.push(`No unreleased changes on \`dev\`; \`${version}\` matches the last release.`, "");
}
parts.push(released.trimEnd(), "");

writeFileSync(BETA, parts.join("\n"));
console.log(`sunreye-beta/CHANGELOG.md written: ${commits.length} unreleased commits`);

#!/usr/bin/env node
// Rebuild the addon's changelog entry for a given version by merging the
// server and web sections for that same version (versions are linked, so the
// entry exists in all three files). The addon ships server (+migrate/db) and
// web as one Home Assistant image, so its changelog should be their union —
// release-please's linked-versions plugin only syncs version numbers and
// leaves the addon with a "Synchronize sunreye-stack versions" placeholder.
//
// Usage:
//   node scripts/addon-changelog.mjs <version> [<version>...]
//
// Rewrites sunreye/CHANGELOG.md in place. For the LAST version passed it also
// prints the merged notes (sections only, no "## [version]" header) to stdout,
// suitable for `gh release edit --notes`.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { categoryRank } from "./lib/changelog-categories.mjs";

const ROOT = process.cwd();
const SERVER_CHANGELOG = join(ROOT, "CHANGELOG.md");
const WEB_CHANGELOG = join(ROOT, "apps/web/CHANGELOG.md");
const ADDON_CHANGELOG = join(ROOT, "sunreye/CHANGELOG.md");

// The linked-versions placeholder carries no information — never surface it.
const PLACEHOLDER_BULLET = /Synchronize .*versions/i;

/** Line range [start, end) of one "## [version] ..." section; start === -1 if absent. */
function sectionBounds(lines, version) {
  const start = lines.findIndex(
    (l) => l.startsWith(`## [${version}]`) || l.startsWith(`## ${version} `),
  );
  if (start === -1) return { start: -1, end: -1 };
  const offset = lines.slice(start + 1).findIndex((l) => l.startsWith("## "));
  return { start, end: offset === -1 ? lines.length : start + 1 + offset };
}

/** Category name of a "### Heading" line, or null. */
function headingCategory(line) {
  const match = line.match(/^### (.+?)\s*$/);
  return match ? match[1] : null;
}

/** A real changelog bullet (not the linked-versions placeholder). */
function isRealBullet(line) {
  return line.startsWith("* ") && !PLACEHOLDER_BULLET.test(line);
}

/** Group a section body's bullets by their "### Category" heading. */
function categoriesFromBody(bodyLines) {
  const categories = new Map();
  // Anything before the first "### Category" lands in this throwaway list and
  // is never registered; release-please emits no bullets there anyway.
  let bullets = [];
  for (const line of bodyLines) {
    const heading = headingCategory(line);
    if (heading) {
      bullets = [];
      categories.set(heading, bullets);
    } else if (isRealBullet(line)) {
      bullets.push(line);
    }
  }
  return categories;
}

/** Parse one "## [version] ..." section into a header line + Map<category, bullet[]>. */
function parseSection(text, version) {
  const lines = text.split("\n");
  const { start, end } = sectionBounds(lines, version);
  if (start === -1) return { headerLine: null, categories: new Map(), start, end };
  return {
    headerLine: lines[start],
    categories: categoriesFromBody(lines.slice(start + 1, end)),
    start,
    end,
  };
}

/** Append items to target, skipping ones already present. */
function appendUnique(target, items) {
  for (const item of items) {
    if (!target.includes(item)) target.push(item);
  }
}

/** Merge several category maps, preserving order-of-appearance and de-duping identical bullets. */
function mergeCategories(maps) {
  const merged = new Map();
  for (const map of maps) {
    for (const [category, bullets] of map) {
      const target = merged.get(category) ?? [];
      appendUnique(target, bullets);
      merged.set(category, target);
    }
  }
  return merged;
}

/** Non-empty categories in conventional-changelog order. */
function orderedCategories(merged) {
  return [...merged.keys()]
    .filter((c) => merged.get(c).length > 0)
    .sort((a, b) => categoryRank(a) - categoryRank(b));
}

/** Body lines beneath the "## [version]" header, matching release-please's spacing. */
function bodyLines(merged) {
  const lines = [];
  for (const category of orderedCategories(merged)) {
    lines.push("", "", `### ${category}`, "");
    lines.push(...merged.get(category));
  }
  return lines;
}

function rewriteVersion(version) {
  const server = parseSection(readFileSync(SERVER_CHANGELOG, "utf8"), version).categories;
  const web = parseSection(readFileSync(WEB_CHANGELOG, "utf8"), version).categories;

  const addonText = readFileSync(ADDON_CHANGELOG, "utf8");
  const addon = parseSection(addonText, version);
  if (addon.headerLine === null) {
    throw new Error(`sunreye/CHANGELOG.md has no "## [${version}]" entry to rewrite`);
  }

  // Keep any real addon-scoped bullets (e.g. a Dockerfile fix) alongside server+web.
  const body = bodyLines(mergeCategories([server, web, addon.categories]));

  // Nothing meaningful to say (all placeholders): leave the entry untouched.
  if (body.length === 0) return null;

  const lines = addonText.split("\n");
  lines.splice(addon.start, addon.end - addon.start, addon.headerLine, ...body, "");
  writeFileSync(ADDON_CHANGELOG, lines.join("\n"));

  return body.join("\n").replace(/^\n+/, "");
}

const versions = process.argv.slice(2);
if (versions.length === 0) {
  console.error("usage: node scripts/addon-changelog.mjs <version> [<version>...]");
  process.exit(1);
}

let lastNotes = "";
for (const version of versions) {
  const notes = rewriteVersion(version);
  if (notes !== null) lastNotes = notes;
}
if (lastNotes) process.stdout.write(lastNotes + "\n");

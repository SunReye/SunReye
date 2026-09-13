#!/usr/bin/env bun
/**
 * Which CI layers a change can possibly affect.
 *
 * The expensive layers in `.github/workflows/ci.yml` are the four browser
 * shards (13 of the 17 runner-minutes an average run costs), the database job
 * and the route smoke. A docs edit, a screenshot swap or an appliance change
 * cannot move any of them, and paying for all three on every push is most of
 * this repo's CI bill.
 *
 * The rule is "provably unaffected", not "probably fine": a path this file does
 * not recognise runs everything, and so does an empty list — an empty diff
 * means the diff could not be computed, never that nothing changed. Getting
 * that backwards disables CI silently, which is far worse than a wasted runner.
 *
 * The logic lives here rather than in YAML so it can be unit-tested; the
 * workflow only feeds it a file list and reads back `name=bool` lines.
 */

export interface Surfaces {
  /** The browser layer (`apps/web/e2e`). It fakes the backend, so only web inputs reach it. */
  web: boolean;
  /** The database layer (`apps/server/db-tests`): schema, queries, the Timescale image. */
  db: boolean;
  /** The route smoke: the booted server and everything it composes. */
  routes: boolean;
}

const ALL: Surfaces = { web: true, db: true, routes: true };

/** Paths that cannot change how any code behaves. */
const INERT = [
  /^apps\/docs\//,
  /^nixos\//,
  /^apps\/appliance-cli\//,
  /^plans\//,
  /^\.claude\//,
  /^\.agents\//,
  /^\.github\/(?!workflows\/ci\.yml)/,
  /^[^/]+\.md$/,
  /^\.gitignore$/,
  /^LICENSE$/,
];

/** Paths that can move every layer: shared code, dependencies, the gate itself. */
const UNIVERSAL = [
  /^packages\//,
  /^bun\.lock$/,
  /^package\.json$/,
  /^tsconfig(?:\.\w+)?\.json$/,
  /^turbo\.json$/,
  /^scripts\//,
  /^\.github\/workflows\/ci\.yml$/,
];

/** Inputs to the browser layer. */
const WEB = [/^apps\/web\//];

/** Inputs to the database layer and the route smoke. */
const SERVER = [/^apps\/server\//, /^docker\//, /^sunreye\//];

const matches = (path: string, patterns: RegExp[]) => patterns.some((p) => p.test(path));

export function surfacesFor(paths: string[]): Surfaces {
  if (paths.length === 0) return { ...ALL };

  const surfaces: Surfaces = { web: false, db: false, routes: false };

  for (const path of paths) {
    if (matches(path, INERT)) continue;
    if (matches(path, UNIVERSAL)) return { ...ALL };

    if (matches(path, WEB)) {
      surfaces.web = true;
      continue;
    }
    if (matches(path, SERVER)) {
      surfaces.db = true;
      surfaces.routes = true;
      continue;
    }

    // Unclassified: it may be anything, so it is everything.
    return { ...ALL };
  }

  return surfaces;
}

if (import.meta.main) {
  const paths = (await Bun.stdin.text())
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const surfaces = surfacesFor(paths);
  for (const [name, run] of Object.entries(surfaces)) console.log(`${name}=${run}`);
}

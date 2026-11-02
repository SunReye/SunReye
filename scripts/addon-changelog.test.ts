import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "addon-changelog.mjs");

const SERVER = `# Changelog

## [9.9.9](https://example.test/compare/server-v9.9.8...server-v9.9.9) (2026-11-02)


### Bug Fixes

* **server:** keep the poll loop alive ([aaaaaaa](https://example.test/commit/aaaaaaa))
`;

const ADDON = `# Changelog

## [9.9.9](https://example.test/compare/addon-v9.9.8...addon-v9.9.9) (2026-11-02)


### Miscellaneous Chores

* **addon:** Synchronize sunreye-stack versions
`;

let root: string;

afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A repo root holding only what release-please still writes: no apps/web/CHANGELOG.md. */
function repoWithoutWebChangelog() {
  root = mkdtempSync(join(tmpdir(), "addon-changelog-"));
  writeFileSync(join(root, "CHANGELOG.md"), SERVER);
  mkdirSync(join(root, "sunreye"));
  writeFileSync(join(root, "sunreye/CHANGELOG.md"), ADDON);
  return root;
}

describe("addon-changelog", () => {
  test("builds the addon entry from the server changelog alone", () => {
    const cwd = repoWithoutWebChangelog();
    const run = Bun.spawnSync([process.execPath, SCRIPT, "9.9.9"], { cwd });

    expect(run.stderr.toString()).toBe("");
    expect(run.exitCode).toBe(0);
    const notes =
      "### Bug Fixes\n\n* **server:** keep the poll loop alive ([aaaaaaa](https://example.test/commit/aaaaaaa))\n";
    expect(run.stdout.toString()).toBe(notes);
    expect(readFileSync(join(cwd, "sunreye/CHANGELOG.md"), "utf8")).toBe(
      `# Changelog\n\n## [9.9.9](https://example.test/compare/addon-v9.9.8...addon-v9.9.9) (2026-11-02)\n\n\n${notes}`,
    );
  });
});

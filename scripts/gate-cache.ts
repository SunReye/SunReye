// What a gate step's inputs hash to (ADR 13): every file git sees under the paths it reads, tracked
// or new, by content. The store sits in the git common dir, so every worktree of the clone shares it.

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface Reads {
  /** Paths whose files git sees, tracked or new. */
  readonly paths: readonly string[];
  /** Folders git ignores but the step reads, such as the SPA build the core embeds. */
  readonly built?: readonly string[];
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the bytes are only read.
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

function listed(root: string, paths: readonly string[]): string[] {
  const found = Bun.spawnSync(
    ["git", "ls-files", "-co", "--exclude-standard", "-z", "--", ...paths],
    {
      cwd: root,
    },
  );

  return decode(found.stdout).split("\0").filter(Boolean);
}

async function walked(root: string, dir: string): Promise<string[]> {
  const found = await readdir(join(root, dir), { recursive: true, withFileTypes: true }).catch(
    () => [],
  );

  return (
    found
      // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a directory entry is only read.
      .filter((entry) => entry.isFile())
      // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a directory entry is only read.
      .map((entry) => join(entry.parentPath, entry.name).slice(root.length))
  );
}

/** The environment a check may read: the build's and test's own switches, not the shell's. */
const READ_ENV =
  /^(?:CARGO|RUST|SOURCE_DATE_EPOCH$|NODE|BUN|VITE|DB_|DATABASE|SKIP_ENV|INVERTER|SUNREYE|TZ$|LANG$|LC_)/u;

function readEnv(env: Readonly<Record<string, string | undefined>>): string[] {
  return Object.entries(env)
    .filter((entry: readonly [string, string | undefined]) => READ_ENV.test(entry[0]))
    .map((entry: readonly [string, string | undefined]) => `${entry[0]}=${entry[1] ?? ""}`)
    .toSorted();
}

/** Hashes each file once per gate run, however many steps read it. */
export function hasher(root: string, env: Readonly<Record<string, string | undefined>>) {
  const hashes = new Map<string, Promise<string>>();

  const hashOf = (path: string): Promise<string> => {
    const known = hashes.get(path);

    if (known !== undefined) return known;

    const found = readFile(join(root, path)).then(
      // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the bytes are only read.
      (bytes) => createHash("sha256").update(bytes).digest("hex"),
      () => "gone",
    );

    hashes.set(path, found);

    return found;
  };

  /** What the step reads hashes to now, salted with the step itself and the runtime. */
  return async (step: string, reads: Readonly<Reads>): Promise<string> => {
    const built = await Promise.all((reads.built ?? []).map((dir) => walked(root, dir)));
    const paths = [...listed(root, reads.paths), ...built.flat()].toSorted();
    const each = await Promise.all(paths.map(async (path) => `${path}\0${await hashOf(path)}`));

    return createHash("sha256")
      .update([Bun.version, step, ...readEnv(env), ...each].join("\0"))
      .digest("hex");
  };
}

/** The git dir every worktree of this clone shares. */
export function commonDir(root: string): string {
  const found = Bun.spawnSync(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: root,
  });

  return decode(found.stdout).trim();
}

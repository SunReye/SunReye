// The component tests in shards side by side (ADR 13), each a vitest of its own with its own
// browser: the 3D scene starves a browser's one software renderer, not the machine's cores.
// `COMPONENT_SHARDS` sets how many; any further arguments go to each vitest.

import { availableParallelism } from "node:os";

const shards = Number(
  process.env["COMPONENT_SHARDS"] ?? Math.max(1, Math.floor(availableParallelism() / 6)),
);

const runs = Array.from(
  { length: shards },
  (_, i) =>
    Bun.spawn(["vitest", "run", `--shard=${i + 1}/${shards}`, ...process.argv.slice(2)], {
      cwd: `${import.meta.dirname}/../apps/web`,
      stdio: ["ignore", "inherit", "inherit"],
    }).exited,
);

const codes = await Promise.all(runs);

process.exitCode = codes.find((code) => code !== 0) ?? 0;

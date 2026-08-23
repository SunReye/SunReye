#!/usr/bin/env bun
/**
 * `profile` — authoring CLI for SunReye inverter profiles.
 *
 *   profile init [dir] [--pkg n] [--id i] [--manufacturer m] [--yes]
 *   profile upgrade [dir] [--force]    refresh the AI authoring guide (AGENTS.md + CLAUDE.md)
 *   profile validate <file> [--strict] strict validation + semantic lints
 *   profile coverage <file>            which renderable roles are mapped
 *   profile replay <capture.json...> [--profile <file>] [--json]
 *                                      golden register captures: do these words
 *                                      still decode to these values?
 *   profile scaffold <csv> --id <id> --name <n> --manufacturer <m> [--version v]
 *   profile build <entries...> --out <dir> [--name n] [--maintainer m] [--bump patch|minor|major]
 *                                         [--require role,role]  required-role floor
 *                                         (default: the anchor role of every family the profile touches)
 *
 * Exits non-zero on validation failure so it's usable as a CI/pre-commit gate.
 * Command bodies live in ./cli-commands (unit-tested); this file only parses
 * argv and dispatches.
 */

import {
  cmdBuild,
  cmdCoverage,
  cmdInit,
  cmdReplay,
  cmdScaffold,
  cmdUpgrade,
  cmdValidate,
  flags,
} from "./cli-commands";

const [command, ...rest] = process.argv.slice(2);

/**
 * Split argv for the variadic commands (`build`, `replay`): every positional up
 * to the first `--` is a path, the rest are flags. Shared rather than repeated,
 * because getting the boundary wrong silently feeds a flag's *value* in as a
 * path — a failure that looks like a missing file rather than a parse bug.
 */
function variadic(args: string[]): { paths: string[]; opts: Record<string, string> } {
  const firstFlag = args.findIndex((a) => a.startsWith("--"));
  return firstFlag === -1
    ? { paths: args, opts: {} }
    : { paths: args.slice(0, firstFlag), opts: flags(args.slice(firstFlag)) };
}

switch (command) {
  case "init": {
    // First positional is the target dir unless it's a flag.
    const hasDir = rest[0] !== undefined && !rest[0].startsWith("--");
    await cmdInit(hasDir ? rest[0] : undefined, flags(hasDir ? rest.slice(1) : rest));
    break;
  }
  case "upgrade": {
    const hasDir = rest[0] !== undefined && !rest[0].startsWith("--");
    await cmdUpgrade(hasDir ? rest[0] : undefined, flags(hasDir ? rest.slice(1) : rest));
    break;
  }
  case "validate":
    await cmdValidate(rest[0], flags(rest.slice(1)));
    break;
  case "coverage":
    await cmdCoverage(rest[0]);
    break;
  case "scaffold":
    await cmdScaffold(rest[0], flags(rest.slice(1)));
    break;
  case "build": {
    const { paths, opts } = variadic(rest);
    await cmdBuild(paths, opts);
    break;
  }
  case "replay": {
    const { paths, opts } = variadic(rest);
    await cmdReplay(paths, opts);
    break;
  }
  default:
    console.error(
      "usage: profile <init|upgrade|validate|coverage|replay|scaffold|build> [file...] [options]",
    );
    process.exit(1);
}

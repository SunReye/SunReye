#!/usr/bin/env bun
/**
 * `sunreye-setup` — the appliance's configuration entry point.
 *
 * Everything that touches the world is behind {@link Io}, and {@link run} is a
 * pure-ish function of it. That is not test decoration: the alternative is a
 * suite that runs `nixos-rebuild` on the developer's machine, so in practice the
 * alternative is no suite at all — and this is the tool that reconfigures a box
 * nobody can physically reach.
 *
 * Order of operations, and why: validate → write → commit → rebuild. The commit
 * comes before the rebuild because `nixos-rebuild --flake /etc/nixos` evaluates
 * the git tree and ignores files git does not know about, so building before
 * committing builds the PREVIOUS configuration and reports success. That failure
 * mode is silent and it is the one this order exists to prevent.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { applyCommand, type Context } from "./commands";
import { parseSite, serializeSite, type SiteConfig } from "./site";

const CONFIG_DIR = "/etc/nixos";
const SITE_JSON = `${CONFIG_DIR}/site.json`;
/**
 * Where the zone database lives. NixOS puts a symlink at /etc/zoneinfo; most
 * other distributions (and the CI container this suite runs in) only have
 * /usr/share/zoneinfo. Checking both means the validation behaves the same on a
 * box and in the suite, instead of rejecting every zone wherever the first path
 * is absent.
 */
const ZONEINFO_ROOTS = ["/etc/zoneinfo", "/usr/share/zoneinfo"] as const;

export type ExecResult = { ok: boolean; output: string };

/** The seam. Every member is something a test must not actually do. */
export type Io = {
  readSite: () => string;
  writeSite: (text: string) => void;
  /** Runs a command to completion, capturing both streams. Never throws. */
  exec: (command: readonly string[], cwd?: string) => ExecResult;
  zoneExists: (timeZone: string) => boolean;
  isRoot: boolean;
  log: (line: string) => void;
  error: (line: string) => void;
};

/**
 * Whether the box has this IANA zone.
 *
 * A path check rather than a list, because the list is the zone database and it
 * differs between nixpkgs revisions. The separator guard matters: a zone name is
 * pasted from a browser, and `../../etc/passwd` would otherwise "exist".
 */
export function systemZoneExists(timeZone: string): boolean {
  if (timeZone.includes("..") || timeZone.startsWith("/")) return false;
  return ZONEINFO_ROOTS.some((root) => {
    const path = `${root}/${timeZone}`;
    return existsSync(path) && statSync(path).isFile();
  });
}

/** Run a command under `git -C /etc/nixos`, so no caller has to remember the cwd. */
function git(io: Io, ...args: readonly string[]): ExecResult {
  return io.exec(["git", ...args], CONFIG_DIR);
}

/**
 * Commit whatever is in /etc/nixos, then switch.
 *
 * The identity is passed per-invocation rather than assumed: a freshly flashed
 * box has no git config, and `git commit` there fails with "please tell me who
 * you are" — which would turn every first configuration command into a puzzle.
 */
function commitAndRebuild(io: Io, summary: string): number {
  const add = git(io, "add", "-A");
  if (!add.ok) {
    io.error(`could not stage ${CONFIG_DIR}: ${add.output}`);
    return 1;
  }
  const commit = git(
    io,
    "-c",
    "user.name=sunreye-setup",
    "-c",
    "user.email=appliance@localhost",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    summary,
  );
  if (!commit.ok) {
    io.error(`could not commit ${CONFIG_DIR}: ${commit.output}`);
    io.error(
      "not rebuilding: nixos-rebuild evaluates the git tree, so it would build the previous configuration and report success.",
    );
    return 1;
  }

  io.log(
    `rebuilding (${summary}) — this takes a few minutes and the dashboard is briefly unavailable`,
  );
  const rebuild = io.exec(["nixos-rebuild", "switch", "--flake", `${CONFIG_DIR}#appliance`]);
  if (!rebuild.ok) {
    io.error(rebuild.output);
    io.error(
      `the rebuild failed; the change is committed but not live. \`git -C ${CONFIG_DIR} log\` shows it, and \`nixos-rebuild switch --rollback\` returns to the running generation.`,
    );
    return 1;
  }
  io.log("done.");
  return 0;
}

/** `show`: the document, plus whether anyone can actually reach this box. */
function show(io: Io, site: SiteConfig): number {
  io.log(serializeSite(site).trimEnd());
  const status = io.exec(["tailscale", "status"]);
  io.log("");
  if (status.ok && status.output.trim() !== "") {
    io.log(status.output.trimEnd());
  } else {
    io.log(
      "tailscale: not enrolled. Open http://<this box>:5252 on the LAN to log it into your tailnet.",
    );
  }
  return 0;
}

/**
 * `tailscale reset`: forget the tailnet and reopen the login window.
 *
 * The only way back to an unenrolled state, and deliberately so — nothing on the
 * box reopens that window on its own, because a box that re-offers its own
 * enrolment page after a reboot is a box anyone on the LAN can take.
 *
 * A logout that fails is not fatal (an already-logged-out node reports one), but
 * a state wipe that fails is: everything after it would re-enrol into the tailnet
 * we were trying to leave.
 */
function reset(io: Io): number {
  const logout = io.exec(["tailscale", "logout"]);
  if (!logout.ok) io.log(`tailscale logout: ${logout.output.trim()} — continuing`);

  const stop = io.exec(["systemctl", "stop", "tailscaled"]);
  if (!stop.ok) {
    io.error(`could not stop tailscaled: ${stop.output}`);
    return 1;
  }
  const wipe = io.exec(["rm", "-rf", "/var/lib/tailscale"]);
  if (!wipe.ok) {
    io.error(`could not clear /var/lib/tailscale: ${wipe.output}`);
    io.error(
      "tailscaled is stopped; start it again with `systemctl start tailscaled` once this is fixed.",
    );
    return 1;
  }
  const start = io.exec(["systemctl", "start", "tailscaled"]);
  if (!start.ok) {
    io.error(`could not start tailscaled: ${start.output}`);
    return 1;
  }
  const web = io.exec(["systemctl", "restart", "tailscale-web"]);
  if (!web.ok) io.log(`tailscale-web did not start: ${web.output.trim()}`);

  io.log(
    "this box has forgotten its tailnet. The login page is open again on port 5252 of the LAN.",
  );
  return 0;
}

/** The whole CLI. Returns the process exit code; never throws. */
export function run(argv: readonly string[], io: Io): number {
  const parsed = parseSite(io.readSite());
  if (!parsed.ok) {
    io.error(parsed.message);
    return 1;
  }

  const ctx: Context = { zoneExists: io.zoneExists, isRoot: io.isRoot };
  const outcome = applyCommand(parsed.site, argv, ctx);

  switch (outcome.kind) {
    case "print":
      io.log(outcome.text);
      return 0;
    case "error":
      io.error(outcome.message);
      return 1;
    case "show":
      return show(io, parsed.site);
    case "reset":
      return reset(io);
    case "apply":
      return commitAndRebuild(io, "apply: rebuild from the current configuration");
    case "update":
      io.writeSite(serializeSite(outcome.site));
      return commitAndRebuild(io, outcome.summary);
  }
  // No default arm on purpose: the switch is exhaustive over Outcome, so adding
  // a kind without handling it here is a compile error rather than a silently
  // unhandled command.
}

/**
 * The real seam, over a set of paths.
 *
 * Parameterised so the suite can exercise it against a temporary directory: the
 * spawn wrapper and the "no file yet means an empty document" rule are both
 * behaviour, and a first boot is precisely the case where the file does not
 * exist. Untested, they are the two things that would break on a box and
 * nowhere else.
 */
export function makeSystemIo(paths: { siteJson: string; configDir: string }): Io {
  return {
    readSite: () => (existsSync(paths.siteJson) ? readFileSync(paths.siteJson, "utf8") : "{}"),
    writeSite: (text) => writeFileSync(paths.siteJson, text, { mode: 0o644 }),
    // An argv array rather than a shell string: the values flowing through here
    // include a time zone and an SSH key someone pasted, and an argv array has
    // no quoting bug available to it.
    exec: (command, cwd) => {
      // Bun.spawnSync THROWS on ENOENT rather than reporting a non-zero exit,
      // and `Io.exec` promises never to throw — every caller in run() branches
      // on `ok` and would otherwise die with a stack trace on a box where a tool
      // is missing (a partial rebuild leaves exactly that state). Caught here so
      // "the command is not installed" is just another failed command.
      try {
        const spawned = Bun.spawnSync({
          cmd: [...command],
          cwd: cwd ?? paths.configDir,
          stdout: "pipe",
          stderr: "pipe",
        });
        return {
          ok: spawned.exitCode === 0,
          output: `${spawned.stdout.toString()}${spawned.stderr.toString()}`,
        };
      } catch (cause) {
        return { ok: false, output: `could not run ${command.join(" ")}: ${String(cause)}` };
      }
    },
    zoneExists: systemZoneExists,
    isRoot: process.getuid?.() === 0,
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  };
}

export const systemIo: Io = makeSystemIo({ siteJson: SITE_JSON, configDir: CONFIG_DIR });

if (import.meta.main) {
  process.exit(run(process.argv.slice(2), systemIo));
}

/**
 * The command surface, as a pure function.
 *
 * `applyCommand` takes the current document and an argv and returns what should
 * happen — it never reads a file, never rebuilds, and never prints. That split
 * is what lets the whole surface be tested without a NixOS box, and it is also
 * the safety property that matters most here: a rebuild on an appliance costs
 * minutes of downtime and a generation on a flash device, so a command that
 * cannot be fully validated must be refused BEFORE anything is written.
 */
import { TLS_MODES, TRANSPORTS, type SiteConfig, type TlsMode, type Transport } from "./site";

/** Facts about the machine the CLI is running on, injected so tests are hermetic. */
export type Context = {
  /** Whether the system has this IANA zone. Backed by /etc/zoneinfo on a box. */
  zoneExists: (timeZone: string) => boolean;
  /** `tailscale reset` wipes state under /var/lib and restarts a unit. */
  isRoot: boolean;
};

/**
 * What the caller should do. A discriminated union rather than "a new config and
 * maybe an error": the no-op case (`print`) and the write case (`update`) are
 * genuinely different actions, and collapsing them into an optional field is how
 * you end up rebuilding because someone re-ran a command.
 */
export type Outcome =
  | { kind: "update"; site: SiteConfig; summary: string }
  | { kind: "print"; text: string }
  | { kind: "show" }
  | { kind: "apply" }
  | { kind: "reset" }
  | { kind: "error"; message: string };

const SSH_KEY_USAGE = "usage: sunreye-setup ssh-key add <key> | remove <key> | list";

const HELP = `sunreye-setup — configure this SunReye appliance

  inverter <host> [--port 502] [--unit 1] [--transport tcp|rtu-over-tcp]
                        point the poller at an inverter (turns simulation off)
  timezone <zone>       the site's IANA zone, e.g. Europe/Berlin
  simulate on|off       run against a fake inverter
  lan-access on [--site-id N] | off
                        advertise this LAN to the tailnet; --site-id adds the
                        4via6 encoding, which is what lets a second site exist
  ssh-key add <key> | remove <key> | list
  tls tailscale|internal|both
                        how the dashboard is served over HTTPS
  tailscale reset       forget this tailnet and reopen the login window (root)
  show                  the current configuration and tailnet status
  apply                 commit and rebuild (every command above does this too)

Anything not listed here goes in /etc/nixos/local.nix, which this tool never
touches — evcc, Home Assistant, your own containers. See the SunReye docs.
`;

/** Only used to tell an address apart from a typo. Resolution is the box's job. */
function isAddress(value: string): boolean {
  if (/^\d+(\.\d+){3}$/.test(value)) {
    return value.split(".").every((octet) => Number(octet) <= 255);
  }
  // A hostname, optionally qualified. Deliberately permissive about what a
  // household router will answer for, strict about what is obviously not a name.
  return /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/.test(
    value,
  );
}

/** An `ssh-ed25519 AAAA… comment` line, as it appears in authorized_keys. */
function isPublicKey(value: string): boolean {
  return /^(ssh-(rsa|ed25519|dss)|ecdsa-sha2-nistp(256|384|521)|sk-(ssh-ed25519|ecdsa-sha2-nistp256)@openssh\.com)\s+[A-Za-z0-9+/=]+(\s|$)/.test(
    value,
  );
}

type Flags = Record<string, string>;

/**
 * Parse `--flag value` pairs, refusing anything unexpected.
 *
 * Refusing is the point. A silently ignored `--unitid` (for `--unit`) writes a
 * config that looks applied and polls the wrong Modbus address, and on an
 * appliance the only symptom is a dashboard with no data.
 */
function parseFlags(
  argv: readonly string[],
  allowed: readonly string[],
): Flags | { error: string } {
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === undefined) continue;
    if (!allowed.includes(flag)) {
      return {
        error: `${flag} is not a flag this command takes (${allowed.join(", ")}). See --help.`,
      };
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      return { error: `${flag} needs a value.` };
    }
    flags[flag] = value;
    i += 1;
  }
  return flags;
}

function isFlagError(value: Flags | { error: string }): value is { error: string } {
  return "error" in value;
}

/** A bounded integer, or the message explaining which flag was wrong. */
function boundedInt(
  flag: string,
  raw: string,
  min: number,
  max: number,
): number | { error: string } {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    return { error: `${flag} must be a whole number between ${min} and ${max}, not '${raw}'.` };
  }
  return n;
}

function isIntError(value: number | { error: string }): value is { error: string } {
  return typeof value !== "number";
}

const error = (message: string): Outcome => ({ kind: "error", message });

/**
 * An update, unless nothing actually changed. Compared structurally rather than
 * field-by-field so that a command added later cannot forget the check.
 */
function settle(before: SiteConfig, after: SiteConfig, summary: string): Outcome {
  if (JSON.stringify(before) === JSON.stringify(after)) {
    return { kind: "print", text: `already set: ${summary}. Nothing to rebuild.` };
  }
  return { kind: "update", site: after, summary };
}

/**
 * The bounded integer flags, as data.
 *
 * A spec table rather than three near-identical blocks: each one is "read the
 * flag if present, refuse if it is out of range, otherwise keep what is already
 * configured", and written out three times that is where a copied bound goes
 * unnoticed. Modbus addresses a slave in one byte and reserves 248–255; 0 is the
 * broadcast address, which some gateways do answer on.
 */
const INVERTER_INT_FLAGS = [
  { flag: "--port", key: "port", min: 1, max: 65535 },
  { flag: "--unit", key: "unitId", min: 0, max: 247 },
] as const;

type InverterNumbers = { port: number; unitId: number };

function inverterNumbers(
  current: InverterNumbers,
  flags: Flags,
): InverterNumbers | { error: string } {
  const resolved = { ...current };
  for (const spec of INVERTER_INT_FLAGS) {
    const raw = flags[spec.flag];
    if (raw === undefined) continue;
    const parsed = boundedInt(spec.flag, raw, spec.min, spec.max);
    if (isIntError(parsed)) return parsed;
    resolved[spec.key] = parsed;
  }
  return resolved;
}

function inverterTransport(current: Transport, flags: Flags): Transport | { error: string } {
  const requested = flags["--transport"];
  if (requested === undefined) return current;
  if (!(TRANSPORTS as readonly string[]).includes(requested)) {
    return { error: `--transport must be one of ${TRANSPORTS.join(", ")}, not '${requested}'.` };
  }
  return requested as Transport;
}

function inverterCommand(site: SiteConfig, rest: readonly string[]): Outcome {
  const [host, ...flagArgs] = rest;
  if (host === undefined) {
    return error(
      "usage: sunreye-setup inverter <host> [--port 502] [--unit 1] [--transport tcp|rtu-over-tcp]",
    );
  }
  if (!isAddress(host)) return error(`'${host}' is not an address or a hostname.`);

  const flags = parseFlags(flagArgs, ["--port", "--unit", "--transport"]);
  if (isFlagError(flags)) return error(flags.error);

  // Narrowed explicitly rather than handing over `site.inverter`: structural
  // typing would accept the whole object, and spreading the result back would
  // then carry its `host` and `simulate` along and undo this very command.
  const numbers = inverterNumbers(
    { port: site.inverter.port, unitId: site.inverter.unitId },
    flags,
  );
  if ("error" in numbers) return error(numbers.error);
  const transport = inverterTransport(site.inverter.transport, flags);
  if (typeof transport !== "string") return error(transport.error);

  return settle(
    site,
    { ...site, inverter: { ...site.inverter, host, ...numbers, transport, simulate: false } },
    `inverter ${host}:${numbers.port} unit ${numbers.unitId} over ${transport}`,
  );
}

function timezoneCommand(site: SiteConfig, rest: readonly string[], ctx: Context): Outcome {
  const zone = rest[0];
  if (zone === undefined) return error("usage: sunreye-setup timezone <zone>, e.g. Europe/Berlin");
  if (!ctx.zoneExists(zone)) {
    return error(
      `this system has no time zone '${zone}'. Every day, month and tariff boundary is cut in local time, so a wrong zone is only visible later in the numbers — check the spelling against \`timedatectl list-timezones\`.`,
    );
  }
  return settle(site, { ...site, timeZone: zone }, `time zone ${zone}`);
}

function simulateCommand(site: SiteConfig, rest: readonly string[]): Outcome {
  const mode = rest[0];
  if (mode !== "on" && mode !== "off") return error("usage: sunreye-setup simulate on|off");
  if (mode === "off" && site.inverter.host === null) {
    return error(
      "there is no inverter configured, so switching simulation off would leave this box polling nothing and recording nothing. Set an address first: sunreye-setup inverter <host>",
    );
  }
  return settle(
    site,
    { ...site, inverter: { ...site.inverter, simulate: mode === "on" } },
    `simulation ${mode}`,
  );
}

function lanAccessCommand(site: SiteConfig, rest: readonly string[]): Outcome {
  const [mode, ...flagArgs] = rest;
  if (mode !== "on" && mode !== "off")
    return error("usage: sunreye-setup lan-access on [--site-id N] | off");
  const flags = parseFlags(flagArgs, ["--site-id"]);
  if (isFlagError(flags)) return error(flags.error);
  const requested = flags["--site-id"];

  if (mode === "off") {
    if (requested !== undefined) {
      return error(
        "--site-id means nothing with `off`; `lan-access off` advertises nothing at all.",
      );
    }
    return settle(site, { ...site, lan: { mode: "none", siteId: null } }, "LAN access off");
  }

  if (!site.tailscale.enable) {
    return error(
      "tailscale is disabled on this box, so there is no tailnet to advertise a route to. Re-enable it in /etc/nixos/local.nix first.",
    );
  }

  if (requested === undefined) {
    // Direct, not both: with no site id there is no 4via6 encoding to add, and
    // the module warns that this is a single-site answer.
    return settle(
      site,
      { ...site, lan: { mode: "direct", siteId: null } },
      "LAN access on (direct prefix)",
    );
  }
  const siteId = boundedInt("--site-id", requested, 1, 65535);
  if (isIntError(siteId)) return error(siteId.error);
  return settle(
    site,
    { ...site, lan: { mode: "both", siteId } },
    `LAN access on (direct prefix and 4via6, site ${siteId})`,
  );
}

function sshKeyList(site: SiteConfig): Outcome {
  const keys = site.ssh.authorizedKeys;
  return {
    kind: "print",
    text:
      keys.length === 0 ? "no keys configured (Tailscale SSH does not need one)" : keys.join("\n"),
  };
}

function sshKeyAdd(site: SiteConfig, key: string): Outcome {
  if (!isPublicKey(key)) {
    return error(
      "that does not look like an SSH public key — paste the whole line from your .pub file.",
    );
  }
  if (site.ssh.authorizedKeys.includes(key)) {
    return { kind: "print", text: "that key is already configured. Nothing to rebuild." };
  }
  return settle(
    site,
    { ...site, ssh: { authorizedKeys: [...site.ssh.authorizedKeys, key] } },
    `added an SSH key (${site.ssh.authorizedKeys.length + 1} configured)`,
  );
}

function sshKeyRemove(site: SiteConfig, key: string): Outcome {
  if (!site.ssh.authorizedKeys.includes(key)) {
    return error("that key is not configured; nothing removed. `ssh-key list` shows what is.");
  }
  return settle(
    site,
    { ...site, ssh: { authorizedKeys: site.ssh.authorizedKeys.filter((k) => k !== key) } },
    "removed an SSH key",
  );
}

function sshKeyCommand(site: SiteConfig, rest: readonly string[]): Outcome {
  const [action, key] = rest;
  if (action === "list") return sshKeyList(site);
  if (key === undefined) return error(SSH_KEY_USAGE);
  if (action === "add") return sshKeyAdd(site, key);
  if (action === "remove") return sshKeyRemove(site, key);
  return error(SSH_KEY_USAGE);
}

function tlsCommand(site: SiteConfig, rest: readonly string[]): Outcome {
  const mode = rest[0];
  if (mode === undefined || !(TLS_MODES as readonly string[]).includes(mode)) {
    return error(`usage: sunreye-setup tls ${TLS_MODES.join("|")}`);
  }
  const wanted = mode as TlsMode;
  if ((wanted === "tailscale" || wanted === "both") && !site.tailscale.enable) {
    return error(
      `tls '${wanted}' needs a certificate for this node's ts.net name, which only tailscale can issue, and tailscale is disabled on this box. Use \`tls internal\`.`,
    );
  }
  return settle(site, { ...site, tls: wanted }, `TLS mode ${wanted}`);
}

function tailscaleCommand(rest: readonly string[], ctx: Context): Outcome {
  if (rest[0] !== "reset") return error("usage: sunreye-setup tailscale reset");
  if (!ctx.isRoot) {
    return error(
      "tailscale reset has to run as root: it stops tailscaled and wipes /var/lib/tailscale. Re-run with sudo.",
    );
  }
  return { kind: "reset" };
}

/**
 * Dispatch, as a table.
 *
 * A table and not a switch: the switch was the one function in this file over
 * the complexity ceiling, and the arms were all the same shape anyway. It also
 * makes the surface enumerable, which is what `help` and the "not a command"
 * message should have been reading all along.
 */
const COMMANDS: Record<
  string,
  (site: SiteConfig, rest: readonly string[], ctx: Context) => Outcome
> = {
  inverter: (site, rest) => inverterCommand(site, rest),
  timezone: (site, rest, ctx) => timezoneCommand(site, rest, ctx),
  simulate: (site, rest) => simulateCommand(site, rest),
  "lan-access": (site, rest) => lanAccessCommand(site, rest),
  "ssh-key": (site, rest) => sshKeyCommand(site, rest),
  tls: (site, rest) => tlsCommand(site, rest),
  tailscale: (_site, rest, ctx) => tailscaleCommand(rest, ctx),
  show: () => ({ kind: "show" }),
  apply: () => ({ kind: "apply" }),
};

const HELP_WORDS = ["help", "--help", "-h"] as const;

export function applyCommand(site: SiteConfig, argv: readonly string[], ctx: Context): Outcome {
  const [command, ...rest] = argv;
  if (command === undefined || (HELP_WORDS as readonly string[]).includes(command)) {
    return { kind: "print", text: HELP };
  }
  const handler = COMMANDS[command];
  if (handler === undefined) {
    return error(`'${command}' is not a sunreye-setup command. Run \`sunreye-setup --help\`.`);
  }
  return handler(site, rest, ctx);
}

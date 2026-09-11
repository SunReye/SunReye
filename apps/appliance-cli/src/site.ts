/**
 * The appliance's configuration document.
 *
 * `/etc/nixos/site.json` is the single source of truth a human (or this CLI)
 * edits, and `site.nix` is a fixed mapping from it onto `appliance.*` options.
 * The indirection is the point: editing Nix requires knowing Nix, and the box's
 * owner is someone who plugged in two cables. It also means this CLI never has
 * to parse or generate Nix — a JSON document round-trips, a hand-written Nix
 * expression does not.
 *
 * Anything not expressible here goes in `local.nix`, which this file never
 * touches, so a rebuild cannot discard someone's own additions.
 */
import { z } from "zod";

/** Transports the inverter poller understands. */
export const TRANSPORTS = ["tcp", "rtu-over-tcp"] as const;
export type Transport = (typeof TRANSPORTS)[number];

/**
 * How much of the site LAN is advertised to the tailnet. Not exported: the CLI
 * reaches these through `lan-access on|off` rather than by name, and the
 * template's `site.nix` hands the string straight to the module, whose own enum
 * option is the second check.
 */
const LAN_MODES = ["none", "direct", "via", "both"] as const;

/** How the dashboard is served over HTTPS. */
export const TLS_MODES = ["tailscale", "internal", "both"] as const;
export type TlsMode = (typeof TLS_MODES)[number];

/**
 * Every field has a default, so a `{}` document — or a missing one — is valid
 * and describes a bootable box. A first boot with no configuration at all has to
 * produce a working dashboard, or the owner has nothing to log into in order to
 * configure it.
 */
const siteSchema = z
  .object({
    timeZone: z.string().default("UTC"),
    inverter: z
      .object({
        host: z.string().nullable().default(null),
        port: z.number().int().min(1).max(65535).default(502),
        unitId: z.number().int().min(0).max(247).default(1),
        transport: z.enum(TRANSPORTS).default("tcp"),
        /**
         * Defaults to true, and `inverter <ip>` turns it off. A box with no
         * inverter configured that polls nothing shows an empty dashboard with
         * no error to explain it; simulating instead makes the first boot
         * self-evident.
         */
        simulate: z.boolean().default(true),
        profile: z.string().nullable().default(null),
      })
      .prefault({}),
    lan: z
      .object({
        mode: z.enum(LAN_MODES).default("none"),
        /** 4via6 site id. The encoding is 16-bit, so 0 is not a site. */
        siteId: z.number().int().min(1).max(65535).nullable().default(null),
      })
      .prefault({}),
    tls: z.enum(TLS_MODES).default("both"),
    tailscale: z.object({ enable: z.boolean().default(true) }).prefault({}),
    ssh: z.object({ authorizedKeys: z.array(z.string()).default([]) }).prefault({}),
  })
  .strict();

export type SiteConfig = z.infer<typeof siteSchema>;

/** What the image ships, and what an empty document means. */
export const DEFAULT_SITE: SiteConfig = siteSchema.parse({});

export type ParseResult = { ok: true; site: SiteConfig } | { ok: false; message: string };

/**
 * Read a document. Never throws: this runs on a headless box where an
 * unhandled exception is a stack trace nobody sees, so every failure has to come
 * back as something the CLI can print next to what to do about it.
 */
export function parseSite(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {
      ok: false,
      message:
        "/etc/nixos/site.json is not valid JSON. Fix it by hand, or restore the last good version with `git -C /etc/nixos checkout site.json`.",
    };
  }

  const parsed = siteSchema.safeParse(raw);
  if (parsed.success) return { ok: true, site: parsed.data };

  const detail = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  return { ok: false, message: `/etc/nixos/site.json is not a valid site document — ${detail}` };
}

/**
 * Two-space JSON with a trailing newline, and the key order the schema declares.
 * Stable formatting is not cosmetic here: this file is committed on every
 * `apply`, and a reformat-on-write would make every diff useless as a record of
 * what the owner actually changed.
 */
export function serializeSite(site: SiteConfig): string {
  return `${JSON.stringify(site, null, 2)}\n`;
}

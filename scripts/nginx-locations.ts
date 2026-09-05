import { readFileSync } from "node:fs";

/**
 * A small reader for the addon's nginx `location` blocks, so the routing the addon
 * actually ships can be asserted in the suite instead of discovered in a
 * container. It models the two matching rules our config uses — exact (`=`)
 * beats everything, otherwise the longest literal prefix wins — and nothing
 * else: there are no regex locations in `sunreye-locations.conf`.
 */

export type NginxLocation = {
  /** `=` (exact), `^~` (prefix, stops regex matching), or `` (plain prefix). */
  modifier: "" | "=" | "^~";
  uri: string;
  /** Everything between the braces, trimmed. */
  body: string;
};

const HEADER = /location\s+(=|\^~)?\s*(\S+)\s*\{/g;

/** The text inside the block that opens at `open`, brace-balanced. */
function block(conf: string, open: number): string {
  let depth = 0;
  for (let i = open; i < conf.length; i++) {
    if (conf[i] === "{") depth++;
    else if (conf[i] === "}" && --depth === 0) return conf.slice(open + 1, i).trim();
  }
  // An unterminated block: hand back the rest, so a truncated config reads as
  // the (wrong) routing it would produce rather than throwing here.
  return conf.slice(open + 1).trim();
}

export function parseLocations(conf: string): NginxLocation[] {
  HEADER.lastIndex = 0;
  const found: NginxLocation[] = [];
  for (const m of conf.matchAll(HEADER)) {
    const open = m.index + m[0].length - 1;
    found.push({
      modifier: (m[1] ?? "") as NginxLocation["modifier"],
      uri: m[2] ?? "",
      body: block(conf, open),
    });
  }
  return found;
}

/** The block nginx would serve `path` from, or `undefined` if none matches. */
export function matchLocation(
  locations: readonly NginxLocation[],
  path: string,
): NginxLocation | undefined {
  const uri = path.split("?")[0] ?? "";
  const exact = locations.find((l) => l.modifier === "=" && l.uri === uri);
  if (exact) return exact;

  return locations
    .filter((l) => l.modifier !== "=" && uri.startsWith(l.uri))
    .sort((a, b) => b.uri.length - a.uri.length)[0];
}

/** The gate below, injectable so the check itself is testable. */
export type NginxIo = {
  read: (path: string) => string;
  log: (message: string) => void;
  error: (message: string) => void;
};

const CONF = new URL("../sunreye/rootfs/etc/nginx/sunreye-locations.conf", import.meta.url)
  .pathname;

export const productionIo: NginxIo = {
  read: (path) => readFileSync(path, "utf8"),
  log: (message) => console.log(message),
  error: (message) => console.error(message),
};

/**
 * The gate: the addon must route the multiplexed live socket to the server.
 * A `/ws` served by the static fallback answers the upgrade with index.html
 * and the dashboard silently never goes live.
 */
export function main(io: NginxIo = productionIo): number {
  const ws = matchLocation(parseLocations(io.read(CONF)), "/ws");
  const body = ws?.body ?? "";

  if (!body.includes("proxy_pass http://sunreye_server;")) {
    io.error("✗ nginx: /ws is not proxied to the server — an upgrade there gets index.html.");
    io.error("  A `location /ws/` prefix does NOT match `/ws`; use `location = /ws`.");
    return 1;
  }
  if (!body.includes("proxy_set_header Upgrade $http_upgrade;")) {
    io.error("✗ nginx: /ws is proxied without the Upgrade headers — no WebSocket handshake.");
    return 1;
  }

  io.log("✓ nginx: /ws reaches the server as an upgraded WebSocket.");
  return 0;
}

if (import.meta.main) process.exit(main());

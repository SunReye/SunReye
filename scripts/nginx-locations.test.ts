import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { type NginxIo, main, matchLocation, parseLocations } from "./nginx-locations";

const conf = readFileSync(
  join(import.meta.dir, "../sunreye/rootfs/etc/nginx/sunreye-locations.conf"),
  "utf8",
);

describe("parseLocations", () => {
  test("reads the modifier, the uri and the block body", () => {
    const [loc] = parseLocations("location = /healthz {\n    proxy_pass http://x;\n}\n");
    expect(loc).toEqual({ modifier: "=", uri: "/healthz", body: "proxy_pass http://x;" });
  });

  test("a bare prefix location has no modifier", () => {
    expect(parseLocations("location /api/ { proxy_pass http://x; }")[0]?.modifier).toBe("");
  });

  test("a nested brace does not end the block early", () => {
    expect(parseLocations("location / { if ($x) { return 403; } root /w; }")[0]?.body).toContain(
      "root /w;",
    );
  });

  test("an unterminated block yields the rest rather than throwing", () => {
    expect(parseLocations("location /ws { proxy_pass http://x;")[0]?.body).toContain("proxy_pass");
  });
});

describe("matchLocation", () => {
  const locs = parseLocations(`
    location = /ws { A }
    location /ws/ { B }
    location / { C }
  `);

  test("an exact location beats every prefix", () => {
    expect(matchLocation(locs, "/ws")?.body).toBe("A");
  });

  test("the longest prefix wins over the catch-all", () => {
    expect(matchLocation(locs, "/ws/metrics")?.body).toBe("B");
  });

  test("anything else falls through to the catch-all", () => {
    expect(matchLocation(locs, "/settings")?.body).toBe("C");
  });

  test("a query string is not part of the path", () => {
    expect(matchLocation(locs, "/ws?token=1")?.body).toBe("A");
  });

  test("no location at all matches nothing", () => {
    expect(matchLocation([], "/ws")).toBeUndefined();
  });

  test("a trailing-slash-only block does not catch the bare path", () => {
    const only = parseLocations("location /ws/ { B }\nlocation / { C }");
    expect(matchLocation(only, "/ws")?.body).toBe("C");
  });
});

/**
 * The addon's own routing. The multiplexed live socket is served at exactly
 * `/ws` — a `location /ws/` block (what the five retired per-topic routes
 * needed) does NOT match it, so the upgrade would be answered by the static
 * SPA fallback with `index.html` and the dashboard would never go live.
 */
describe("the addon's nginx routing", () => {
  const locs = parseLocations(conf);

  test("/ws reaches the server, not the static fallback", () => {
    const ws = matchLocation(locs, "/ws");
    expect(ws?.body).toContain("proxy_pass http://sunreye_server;");
  });

  test("/ws is upgraded to a WebSocket", () => {
    const body = matchLocation(locs, "/ws")?.body ?? "";
    expect(body).toContain("proxy_set_header Upgrade $http_upgrade;");
    expect(body).toContain("proxy_set_header Connection $connection_upgrade;");
    expect(body).toContain("proxy_http_version 1.1;");
  });

  test("/ws is trusted as our own front door, like every other engine route", () => {
    expect(matchLocation(locs, "/ws")?.body).toContain('proxy_set_header X-SunReye-Proxied "1";');
  });

  test("the SPA entry page is revalidated, so a new build is not shadowed by the old one", () => {
    const body = matchLocation(locs, "/settings")?.body ?? "";
    expect(body).toContain("/index.html");
    expect(body).toContain('add_header Cache-Control "no-cache"');
  });

  test("hashed assets stay immutable", () => {
    expect(matchLocation(locs, "/_app/immutable/x.js")?.body).toContain("immutable");
  });

  test("the engine routes still reach the server", () => {
    for (const path of ["/api/history/recent", "/openapi", "/healthz"]) {
      expect(matchLocation(locs, path)?.body).toContain("proxy_pass http://sunreye_server;");
    }
  });
});

describe("main", () => {
  const io = (source: string) => {
    const out: string[] = [];
    const fake: NginxIo = {
      read: () => source,
      log: (m) => out.push(m),
      error: (m) => out.push(m),
    };
    return { fake, out };
  };

  test("the shipped config passes", () => {
    const { fake, out } = io(conf);
    expect(main(fake)).toBe(0);
    expect(out.join("\n")).toContain("/ws");
  });

  test("a prefix-only /ws block fails, with the reason", () => {
    const { fake, out } = io("location /ws/ { proxy_pass http://sunreye_server; }\nlocation / { }");
    expect(main(fake)).toBe(1);
    expect(out.join("\n")).toContain("not proxied to the server");
  });

  test("a /ws that is proxied but not upgraded fails", () => {
    const { fake, out } = io("location = /ws { proxy_pass http://sunreye_server; }");
    expect(main(fake)).toBe(1);
    expect(out.join("\n")).toContain("Upgrade");
  });
});

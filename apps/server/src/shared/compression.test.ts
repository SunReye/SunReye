/**
 * What the compress plugin actually does to our responses.
 *
 * Written as assertions rather than trust: the plugin is a 2.0 beta, and the
 * two things that would quietly hurt us — a missing `Vary`, and a raw
 * `Response` (which is how the dashboard's assets leave `../web/static`) being
 * skipped — are both invisible until a cache serves the wrong body.
 */
import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { compression } from "./compression";
import { webRoutes } from "../web/static";

const bytes = (s: string) => new TextEncoder().encode(s);
/** Comfortably over the 1 KB threshold, and compressible. */
const big = "SunReye ".repeat(400);

const app = () =>
  new Elysia()
    .use(compression())
    .get("/json", () => ({ rows: Array.from({ length: 200 }, (_, i) => ({ i, v: "sample" })) }))
    .get("/small", () => "tiny")
    .get("/text", () => big)
    // How ../web/static answers: a Response built by hand, not a mapped value.
    .get(
      "/asset.js",
      () =>
        new Response(bytes(big), { headers: { "content-type": "text/javascript; charset=utf-8" } }),
    )
    .get("/image.png", () => new Response(bytes(big), { headers: { "content-type": "image/png" } }))
    .get(
      "/prepacked",
      () =>
        new Response(bytes("already"), {
          headers: { "content-type": "text/javascript", "content-encoding": "br" },
        }),
    );

const fetchWith = (path: string, accept?: string) =>
  app().handle(
    new Request(`http://localhost${path}`, {
      headers: accept === undefined ? {} : { "accept-encoding": accept },
    }),
  );

describe("compression", () => {
  it("compresses a large JSON response so it still round-trips", async () => {
    const res = await fetchWith("/json", "gzip");
    expect(res.headers.get("content-encoding")).toBe("gzip");
    const raw = new Uint8Array(await res.arrayBuffer());
    const back = JSON.parse(new TextDecoder().decode(Bun.gunzipSync(raw))) as { rows: unknown[] };
    expect(back.rows).toHaveLength(200);
  });

  // Server preference, measured: zstd is both smaller than gzip and ~2.8x
  // cheaper than either alternative — see ./compression.ts.
  it("prefers zstd when the client takes everything", async () => {
    const res = await fetchWith("/json", "gzip, deflate, br, zstd");
    expect(res.headers.get("content-encoding")).toBe("zstd");
  });

  it("falls back to brotli for a client that takes it but not zstd", async () => {
    const res = await fetchWith("/json", "gzip, deflate, br");
    expect(res.headers.get("content-encoding")).toBe("br");
  });

  // Nothing prefers deflate over gzip, so it is not offered at all.
  it("does not answer with deflate even when that is all that is left", async () => {
    const res = await fetchWith("/json", "deflate");
    expect(res.headers.get("content-encoding")).toBeNull();
  });

  it("leaves a response below the threshold alone", async () => {
    const res = await fetchWith("/small", "gzip");
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(await res.text()).toBe("tiny");
  });

  it("sends identity when the client offers no encoding", async () => {
    const res = await fetchWith("/text");
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(await res.text()).toBe(big);
  });

  it("honours an explicit refusal", async () => {
    const res = await fetchWith("/text", "gzip;q=0");
    expect(res.headers.get("content-encoding")).toBeNull();
  });

  // This is the case the whole dashboard depends on: assets leave ../web/static
  // as a hand-built Response, and a plugin that only maps plain values would
  // silently ship all 2.4 MB uncompressed.
  it("compresses a hand-built Response, not just a mapped value", async () => {
    const res = await fetchWith("/asset.js", "gzip");
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
  });

  // Already-compressed formats cost CPU to re-encode and give nothing back.
  it("does not recompress a format that carries its own codec", async () => {
    const res = await fetchWith("/image.png", "gzip");
    expect(res.headers.get("content-encoding")).toBeNull();
  });

  it("does not double-encode a response that already declares an encoding", async () => {
    const res = await fetchWith("/prepacked", "gzip");
    expect(res.headers.get("content-encoding")).toBe("br");
    expect(await res.text()).toBe("already");
  });

  // Without this a shared cache — the addon's nginx, or anything between the
  // dashboard and the engine — can hand a gzip body to a client that never
  // asked for one.
  it("varies on Accept-Encoding whether or not it compressed", async () => {
    expect((await fetchWith("/text", "gzip")).headers.get("vary")).toContain("Accept-Encoding");
    expect((await fetchWith("/text")).headers.get("vary")).toContain("Accept-Encoding");
    expect((await fetchWith("/small", "gzip")).headers.get("vary")).toContain("Accept-Encoding");
  });

  // The dashboard is a separately mounted instance, and a plugin whose hooks
  // stopped at its own instance would leave every asset uncompressed while all
  // the assertions above still passed.
  it("reaches a separately mounted plugin's routes", async () => {
    const assets = new Map([["/index.html", bytes(big)]]);
    const mounted = new Elysia().use(compression()).use(webRoutes(assets));
    const res = await mounted.handle(
      new Request("http://localhost/", { headers: { "accept-encoding": "gzip, br, zstd" } }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBe("zstd");
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect((await res.arrayBuffer()).byteLength).toBeLessThan(bytes(big).byteLength);
  });
});

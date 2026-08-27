import { describe, expect, it } from "bun:test";
import { contentTypeFor, packAssets, unpackAssets } from "./asset-pack";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("packAssets / unpackAssets", () => {
  it("round-trips paths and exact bytes", () => {
    const entries = new Map([
      ["/index.html", bytes("<!doctype html>")],
      ["/_app/immutable/app.js", bytes("console.log(1)")],
    ]);
    const back = unpackAssets(packAssets(entries));
    expect([...back.keys()].sort()).toEqual(["/_app/immutable/app.js", "/index.html"]);
    expect(new TextDecoder().decode(back.get("/index.html")!)).toBe("<!doctype html>");
    expect(new TextDecoder().decode(back.get("/_app/immutable/app.js")!)).toBe("console.log(1)");
  });

  it("preserves binary content byte-for-byte", () => {
    const raw = new Uint8Array([0, 255, 13, 10, 0, 127, 200]);
    const back = unpackAssets(packAssets(new Map([["/favicon.ico", raw]])));
    expect([...back.get("/favicon.ico")!]).toEqual([...raw]);
  });

  it("packs deterministically regardless of insertion order", () => {
    const a = packAssets(
      new Map([
        ["/a", bytes("1")],
        ["/b", bytes("2")],
      ]),
    );
    const b = packAssets(
      new Map([
        ["/b", bytes("2")],
        ["/a", bytes("1")],
      ]),
    );
    expect([...a]).toEqual([...b]);
  });

  it("round-trips an empty pack", () => {
    expect(unpackAssets(packAssets(new Map())).size).toBe(0);
  });

  // The committed placeholder is a zero-byte file (the real pack is written by
  // the web build), so the binary must boot API-only instead of throwing.
  it("treats a zero-byte pack as nothing embedded", () => {
    expect(unpackAssets(new Uint8Array()).size).toBe(0);
  });

  it("rejects a truncated pack rather than serving partial bytes", () => {
    const full = packAssets(new Map([["/index.html", bytes("<!doctype html>")]]));
    expect(() => unpackAssets(full.slice(0, full.length - 4))).toThrow();
  });

  it("rejects a pack whose header is not this format", () => {
    expect(() => unpackAssets(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow();
  });
});

describe("contentTypeFor", () => {
  it("types the asset kinds the build emits", () => {
    expect(contentTypeFor("/index.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeFor("/_app/immutable/app.js")).toBe("text/javascript; charset=utf-8");
    expect(contentTypeFor("/_app/immutable/app.css")).toBe("text/css; charset=utf-8");
    expect(contentTypeFor("/favicon.svg")).toBe("image/svg+xml");
    expect(contentTypeFor("/fonts/geist.woff2")).toBe("font/woff2");
    expect(contentTypeFor("/manifest.webmanifest")).toBe("application/manifest+json");
    expect(contentTypeFor("/data.json")).toBe("application/json");
  });

  it("falls back to a byte stream for an unknown extension", () => {
    expect(contentTypeFor("/weird.qqq")).toBe("application/octet-stream");
    expect(contentTypeFor("/noextension")).toBe("application/octet-stream");
  });

  it("matches the extension case-insensitively", () => {
    expect(contentTypeFor("/LOGO.SVG")).toBe("image/svg+xml");
  });
});

import { describe, expect, it } from "bun:test";
import { isCompressible, negotiateEncoding, variantKey } from "./encoding";

describe("variantKey", () => {
  // URL paths always start with "/", so a NUL-prefixed key can never collide
  // with a real asset path inside the same flat pack.
  it("namespaces a variant away from every real path", () => {
    expect(variantKey("gzip", "/index.html")).toBe("\0gzip/index.html");
    expect(variantKey("br", "/_app/immutable/app.js")).toBe("\0br/_app/immutable/app.js");
  });
});

describe("isCompressible", () => {
  it("compresses the text formats the build emits", () => {
    for (const p of ["/index.html", "/a.js", "/a.css", "/a.json", "/a.svg", "/a.webmanifest"]) {
      expect(isCompressible(p)).toBe(true);
    }
  });

  // Recompressing these wastes build time and pack space for nothing — woff2
  // is already brotli internally, and the image formats carry their own codec.
  it("leaves already-compressed formats alone", () => {
    for (const p of ["/f.woff2", "/f.woff", "/i.png", "/i.jpg", "/i.webp", "/i.avif", "/i.ico"]) {
      expect(isCompressible(p)).toBe(false);
    }
  });

  it("treats an unknown extension as not worth compressing", () => {
    expect(isCompressible("/thing.qqq")).toBe(false);
    expect(isCompressible("/noext")).toBe(false);
  });
});

describe("negotiateEncoding", () => {
  const both = new Set(["br", "gzip"]);

  it("prefers brotli when the client takes both", () => {
    expect(negotiateEncoding("gzip, deflate, br, zstd", both)).toBe("br");
  });

  it("falls back to gzip when brotli is not offered by the client", () => {
    expect(negotiateEncoding("gzip, deflate", both)).toBe("gzip");
  });

  it("falls back to gzip when brotli was not packed", () => {
    expect(negotiateEncoding("gzip, br", new Set(["gzip"]))).toBe("gzip");
  });

  // curl sends no Accept-Encoding at all; it must get the raw bytes.
  it("serves identity with no header, an empty header, or no variants", () => {
    expect(negotiateEncoding(null, both)).toBeNull();
    expect(negotiateEncoding("", both)).toBeNull();
    expect(negotiateEncoding("gzip, br", new Set())).toBeNull();
  });

  it("honours q=0 as an explicit refusal", () => {
    expect(negotiateEncoding("br;q=0, gzip", both)).toBe("gzip");
    expect(negotiateEncoding("br;q=0, gzip;q=0", both)).toBeNull();
  });

  it("ranks by q-value rather than listed order", () => {
    expect(negotiateEncoding("br;q=0.1, gzip;q=0.9", both)).toBe("gzip");
  });

  it("accepts a wildcard", () => {
    expect(negotiateEncoding("*", both)).toBe("br");
    expect(negotiateEncoding("*;q=0", both)).toBeNull();
  });

  it("ignores encodings it cannot serve", () => {
    expect(negotiateEncoding("zstd, compress", both)).toBeNull();
  });

  it("is case- and whitespace-insensitive", () => {
    expect(negotiateEncoding("  GZIP ;q=1.0 ", both)).toBe("gzip");
  });
});

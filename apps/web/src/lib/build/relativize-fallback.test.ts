import { describe, expect, test } from "bun:test";

import { relativizeFallback } from "./relativize-fallback";

describe("relativizeFallback", () => {
  test("rewrites root-absolute bundle, favicon, manifest and icon URLs to relative", () => {
    const html = [
      '<link rel="icon" href="/favicon.svg" />',
      '<link rel="manifest" href="/manifest.webmanifest" />',
      '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />',
      '<script src="/_app/immutable/entry/start.js"></script>',
    ].join("\n");
    const out = relativizeFallback(html);
    expect(out).toContain('href="./favicon.svg"');
    expect(out).toContain('href="./manifest.webmanifest"');
    expect(out).toContain('href="./icons/apple-touch-icon.png"');
    expect(out).toContain('src="./_app/immutable/entry/start.js"');
    expect(out).not.toMatch(/"\/(?:_app|favicon|manifest|icons)/);
  });

  test("leaves already-relative URLs alone", () => {
    const html = '<link href="./favicon.svg" /><script src="./_app/x.js"></script>';
    expect(relativizeFallback(html)).toBe(html);
  });

  test("throws when a root-absolute static URL survives", () => {
    expect(() => relativizeFallback('<a href="/_app/">')).not.toThrow();
    expect(() => relativizeFallback("<script src='/_app/x.js'>")).toThrow(/root-absolute/);
  });
});

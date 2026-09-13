/**
 * The dashboard is installable as a PWA: a web app manifest, PNG icons, and
 * the head tags mobile browsers read. Everything here is a static file, so
 * the test reads the files from disk and checks the contract that makes the
 * install prompt appear — and, because the app is served under a path prefix
 * (Home Assistant ingress), that every URL in the manifest is RELATIVE.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const WEB_DIR = fileURLToPath(new URL("..", import.meta.url));
const STATIC_DIR = `${WEB_DIR}static/`;

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

interface Manifest {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: ManifestIcon[];
}

const manifest = JSON.parse(readFileSync(`${STATIC_DIR}manifest.webmanifest`, "utf8")) as Manifest;
const appHtml = readFileSync(`${WEB_DIR}src/app.html`, "utf8");

/** Width/height from a PNG's IHDR chunk — the only thing about the pixels we assert. */
function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(bytes.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("web app manifest", () => {
  test("names the app and opens standalone", () => {
    expect(manifest.name).toBe("SunReye");
    expect(manifest.short_name).toBe("SunReye");
    expect(manifest.display).toBe("standalone");
  });

  test("start_url and scope are relative so ingress prefixes survive", () => {
    expect(manifest.start_url).toBe("./");
    expect(manifest.scope).toBe("./");
  });

  test("brand colours are the flat blue sun on white", () => {
    expect(manifest.theme_color).toBe("#2563eb");
    expect(manifest.background_color).toBe("#ffffff");
  });

  test("ships the icon set Chrome and Safari need to install", () => {
    const sizes = manifest.icons.map(
      (icon) => `${icon.sizes}${icon.purpose === "maskable" ? " maskable" : ""}`,
    );
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512", "512x512 maskable"]));
    expect(manifest.icons.every((icon) => icon.type === "image/png")).toBe(true);
  });

  test("every icon is a relative path to a PNG of the declared size", () => {
    for (const icon of manifest.icons) {
      expect(icon.src.startsWith("./")).toBe(true);
      const path = `${STATIC_DIR}${icon.src.slice(2)}`;
      expect(existsSync(path)).toBe(true);
      const [w, h] = icon.sizes.split("x").map(Number);
      expect(pngSize(path)).toEqual({ width: w, height: h });
    }
  });
});

describe("app.html head", () => {
  test("links the manifest through the assets placeholder", () => {
    expect(appHtml).toContain(
      '<link rel="manifest" href="%sveltekit.assets%/manifest.webmanifest" />',
    );
  });

  test("declares the theme colour that the manifest declares", () => {
    expect(appHtml).toContain(`<meta name="theme-color" content="${manifest.theme_color}" />`);
  });

  test("ships a 180px apple-touch-icon for iOS home screens", () => {
    const match = appHtml.match(
      /<link rel="apple-touch-icon" href="%sveltekit.assets%\/(icons\/[\w.-]+\.png)" \/>/,
    );
    expect(match).not.toBeNull();
    expect(pngSize(`${STATIC_DIR}${match?.[1]}`)).toEqual({ width: 180, height: 180 });
  });

  test("opts into standalone mode on iOS and Android", () => {
    expect(appHtml).toContain('<meta name="mobile-web-app-capable" content="yes" />');
    expect(appHtml).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />');
    expect(appHtml).toContain('<meta name="apple-mobile-web-app-title" content="SunReye" />');
  });

  test("never hardcodes a root-absolute static URL", () => {
    expect(appHtml).not.toMatch(/href="\/(?!\/)/);
  });
});

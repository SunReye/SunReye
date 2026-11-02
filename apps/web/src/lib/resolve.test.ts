import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";

// mock-hygiene-ignore-next-line -- a SvelteKit virtual module: there is no real module to import or spread under bun test.
mock.module("$app/environment", () => ({ browser: false }));

const { resolve, routePath } = await import("./resolve");

const realLocation = globalThis.location;

afterEach(() => {
  // mock-hygiene-ignore-next-line -- same virtual module; the server-side value is the one every other file expects.
  mock.module("$app/environment", () => ({ browser: false }));
  globalThis.location = realLocation;
});

afterAll(() => {
  // mock-hygiene-ignore-next-line -- same virtual module, handed back as the server-side value.
  mock.module("$app/environment", () => ({ browser: false }));
});

function inBrowser(pathname: string, search: string) {
  // mock-hygiene-ignore-next-line -- same virtual module, flipped to the browser for one case.
  mock.module("$app/environment", () => ({ browser: true }));
  globalThis.location = { pathname, search } as Location;
}

describe("resolve", () => {
  test("on the server it is the bare hash route", () => {
    expect(resolve("/history")).toBe("#/history");
  });

  test("in the browser it anchors the hash to the current document URL", () => {
    inBrowser("/api/hassio_ingress/abc/", "");
    expect(resolve("/history")).toBe("/api/hassio_ingress/abc/#/history");
  });

  test("the query string of the document survives, so the pathname stays byte-identical", () => {
    inBrowser("/", "?lang=de");
    expect(resolve("/history")).toBe("/?lang=de#/history");
  });
});

describe("routePath", () => {
  const url = (hash: string) => new URL(`http://host/app/${hash}`);

  test("strips the leading # to leave the route", () => {
    expect(routePath(url("#/history"))).toBe("/history");
  });

  test("drops a trailing query or inner hash", () => {
    expect(routePath(url("#/history?range=7d"))).toBe("/history");
    expect(routePath(url("#/history#top"))).toBe("/history");
  });

  test("an empty or bare hash is the root", () => {
    expect(routePath(url(""))).toBe("/");
    expect(routePath(url("#"))).toBe("/");
    expect(routePath(url("#?x=1"))).toBe("/");
  });

  test("the document's own pathname is never the route", () => {
    expect(routePath(new URL("http://host/api/hassio_ingress/abc/#/settings"))).toBe("/settings");
  });
});

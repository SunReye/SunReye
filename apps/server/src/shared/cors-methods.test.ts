import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CORS_METHODS } from "./cors-methods";

// Every HTTP method a route file registers must be on the CORS allow-list, or a
// browser on another origin (the Vite dev server, a forwarded port) is refused at
// preflight: "Method PATCH is not allowed by Access-Control-Allow-Methods". That
// is how device edits broke in dev while every route test stayed green — the
// unit layer never sends a preflight.
const SRC = join(import.meta.dir, "..");
const ROUTE_FILES = [
  join(SRC, "index.ts"),
  ...readdirSync(join(SRC, "routes"))
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => join(SRC, "routes", f)),
];
const REGISTRATION = /\.(get|post|put|patch|delete)\(\s*["'`]\//g;

describe("CORS_METHODS", () => {
  test("covers every method the route files register", () => {
    const used = new Set<string>();
    for (const file of ROUTE_FILES) {
      for (const m of readFileSync(file, "utf8").matchAll(REGISTRATION)) {
        used.add((m[1] as string).toUpperCase());
      }
    }
    expect([...used].sort()).toContain("PATCH"); // the scan sees the devices routes
    for (const method of used) expect(CORS_METHODS).toContain(method);
  });

  test("allows the preflight itself", () => {
    expect(CORS_METHODS).toContain("OPTIONS");
  });
});

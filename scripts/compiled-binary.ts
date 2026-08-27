/**
 * That a COMPILED binary can serve a validating route.
 *
 * The unit suite cannot prove this. Elysia 2 loads TypeBox through a
 * synchronous `require()` inside its route compiler, and under `bun run`
 * node_modules is right there, so the require succeeds and the bug is
 * invisible. `bun build --compile` cannot bundle a dynamic require, so the
 * binary ships without TypeBox — and because the require happens when a route
 * with a schema is first COMPILED, not at boot, the server starts happily and
 * then 500s the first real request:
 *
 *     [Elysia] Failed to compile route GET /api/cost:
 *     Cannot find module 'typebox/value'
 *
 * Reproducing that needs a real compile and a real request, which is what this
 * does — with a throwaway app, so it needs no database, no inverter and no env.
 *
 * Run: `bun run test:binary`.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FIXTURE = `
import { Elysia, t } from "elysia";
import { setupStaticTypebox } from "../src/shared/typebox-static";

setupStaticTypebox();

const app = new Elysia()
  // A schema is the whole point: this is the route whose compilation used to
  // reach for a module the binary does not contain.
  .get("/validated", { query: t.Object({ n: t.Numeric() }) }, ({ query }) => ({ n: query.n }))
  .get("/plain", () => "ok");

const plain = await app.handle(new Request("http://localhost/plain"));
if (plain.status !== 200) throw new Error("plain route failed: " + plain.status);

const good = await app.handle(new Request("http://localhost/validated?n=41"));
const body = await good.text();
if (good.status !== 200) throw new Error("validated route failed: " + good.status + " " + body);
if (JSON.parse(body).n !== 41) throw new Error("coercion failed: " + body);

// The validator has to still REJECT, or a broken namespace would pass this by
// accepting everything.
const bad = await app.handle(new Request("http://localhost/validated?n=nope"));
if (bad.status !== 422) throw new Error("expected 422 for a bad query, got " + bad.status);

console.log("OK");
`;

// The fixture has to sit INSIDE apps/server: module resolution walks up from
// the file, and `elysia` only exists in that workspace's node_modules. A
// fixture in /tmp cannot resolve it.
const scratch = mkdtempSync(
  join(Bun.fileURLToPath(new URL("../apps/server", import.meta.url)), ".binary-check-"),
);
const out = join(mkdtempSync(join(tmpdir(), "sunreye-binary-")), "fixture-bin");
const entry = join(scratch, "fixture.ts");
let failed = false;

try {
  writeFileSync(entry, FIXTURE);

  const built = Bun.spawnSync([
    "bun",
    "build",
    "--compile",
    "--minify",
    "--external",
    "serialport",
    entry,
    "--outfile",
    out,
  ]);
  if (!built.success) {
    console.error(built.stderr.toString());
    throw new Error("compile failed");
  }

  const ran = Bun.spawnSync([out]);
  const stdout = ran.stdout.toString().trim();
  const stderr = ran.stderr.toString().trim();

  failed = !ran.success || !stdout.endsWith("OK");
  if (failed) {
    console.error(`\n✖ The compiled binary cannot serve a validating route.\n`);
    if (stderr) console.error(stderr);
    if (stdout) console.error(stdout);
    console.error(
      "\n  If this says \"Cannot find module 'typebox/…'\", something stopped\n" +
        "  apps/server/src/shared/typebox-static from wiring the namespaces\n" +
        "  statically — Elysia's lazy require is back, and only a compiled\n" +
        "  binary shows it.\n",
    );
  } else {
    console.log("✓ Compiled binary: a route with a schema compiles, coerces and rejects.");
  }
} finally {
  // The scratch directory lives inside apps/server (see above), so leaving one
  // behind would put a stray fixture in the repo. `process.exit` skips
  // `finally`, which is why the failure exits AFTER this block, not inside it.
  rmSync(scratch, { recursive: true, force: true });
  rmSync(join(out, ".."), { recursive: true, force: true });
}

if (failed) process.exit(1);

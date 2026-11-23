// A second consumer runs the builder (ADR 25): the fixture app in `fixtures/consumer`, copied beside
// this repository as SunReye Plan's checkout stands, installs the packages by path, type-checks and
// builds with one copy of each package; in Chromium it shows one scene from above and in 3D with one
// roof face selected in both, and fills a roof face with modules in the builder's frame.
// A gate step: it builds the pv crate's engine and the builder's messages as the consumer would.

import { readFileSync } from "node:fs";
import { cp, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Glob } from "bun";
import { chromium, type Page } from "playwright";

/** The package an installed file belongs to: its folder under the last `node_modules`. */
function packageOf(id: string): readonly [name: string, root: string] | null {
  const found = /^(.*\/node_modules\/((?:@[^/]+\/)?[^/]+))\//u.exec(id);

  return found === null ? null : [found[2] ?? "", found[1] ?? ""];
}

/** The roots of each package the modules `ids` belong to, by name. */
function rootsOf(ids: readonly string[]): Map<string, Set<string>> {
  const roots = new Map<string, Set<string>>();

  for (const id of ids) {
    const found = packageOf(id);

    if (found !== null) roots.set(found[0], (roots.get(found[0]) ?? new Set()).add(found[1]));
  }

  return roots;
}

/** What a bundle of the modules `ids` reads from outside the consumer's `install`, and each package
 * it reads twice at one `version`: two copies of Svelte or three.js break the page, two of a kit
 * double it. Another version nested where a package asks for it is that package's own. */
export function strays(
  ids: readonly string[],
  install: string,
  version: (root: string) => string,
): string[] {
  const found: string[] = [];

  for (const [name, where] of rootsOf(ids)) {
    const seen = new Set<string>();

    for (const root of where) {
      const at = version(root);

      if (!root.startsWith(`${install}/`)) found.push(`${name}: ${root}`);

      if (seen.has(at)) found.push(`${name}: two copies of ${at}`);

      seen.add(at);
    }
  }

  return found;
}

/** The version in the package.json at `root`. */
function versionAt(root: string): string {
  const manifest: unknown = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

  return manifest instanceof Object && "version" in manifest ? String(manifest.version) : "";
}

/** The source files of every module in the client bundle `client` holds, from its source maps,
 * which name them relative to where the build wrote them. Not a web worker's: Vite names its sources
 * from another folder. */
function bundled(client: string): string[] {
  const ids: string[] = [];

  for (const map of new Glob("_app/immutable/{chunks,entry,nodes}/*.js.map").scanSync(client)) {
    const parsed: unknown = JSON.parse(readFileSync(join(client, map), "utf8"));
    const sources = parsed instanceof Object && "sources" in parsed ? parsed.sources : [];

    for (const source of Array.isArray(sources) ? sources : []) {
      ids.push(resolve(dirname(join(client, map)), String(source)));
    }
  }

  return ids;
}

/** The fixture beside a link to this repository, named as Plan names it: `../home`. */
async function stage(root: string): Promise<string> {
  const beside = await mkdtemp(join(tmpdir(), "sunreye-consumer-"));

  await symlink(root, join(beside, "home"));
  await cp(join(root, "fixtures/consumer"), join(beside, "consumer"), {
    recursive: true,
    filter: (from) => !/\/(?:node_modules|\.svelte-kit|build)$/u.test(from),
  });

  return beside;
}

/** Runs `command` in the consumer, its output shown; throws when it fails. */
async function step(command: readonly string[], cwd: string): Promise<void> {
  const child = Bun.spawn([...command], { cwd, stdio: ["inherit", "inherit", "inherit"] });

  if ((await child.exited) !== 0) throw new Error(`failed: ${command.join(" ")}`);
}

/** Serves the static build, the SPA's fallback page for every path without a file. */
function serve(built: string) {
  return Bun.serve({
    port: 0,
    async fetch(request) {
      const file = Bun.file(join(built, new URL(request.url).pathname));

      return new Response((await file.exists()) ? file : Bun.file(join(built, "index.html")));
    },
  });
}

/** A screenshot of `label`'s canvas, once two in a row are the same: the studio has settled.
 * Throws after `tries` screenshots that each differ from the last. */
async function settled(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright's page.
  page: Page,
  label: string,
  tries = 240,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a Buffer is mutable.
  last?: Buffer,
): Promise<Buffer> {
  const shot = await page.getByLabel(label, { exact: true }).screenshot();

  if (last?.equals(shot) === true) return shot;

  if (tries <= 1) throw new Error(`the ${label} never stopped changing`);

  await page.waitForTimeout(250);

  return settled(page, label, tries - 1, shot);
}

/** One scene from above and in 3D: a click on a roof from above selects it in both. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright's page is mutable.
async function twoViews(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.getByText("Both views drawn").waitFor();

  const before = await settled(page, "3D view");
  const top = page.getByLabel("Top view", { exact: true });
  const box = await top.boundingBox();

  // Below the ridge seen from above, north up: the south face.
  await top.click({ position: { x: (box?.width ?? 0) / 2, y: ((box?.height ?? 0) * 3) / 4 } });
  await page.getByRole("status").getByText("Block 1, face 2").waitFor();

  if (before.equals(await settled(page, "3D view"))) {
    throw new Error("the 3D view did not mark the face selected from above");
  }
}

/** The builder's frame lays a face full of modules, in the words the consumer set. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright's page is mutable.
async function edit(page: Page, url: string): Promise<void> {
  await page.goto(`${url}edit`);

  const inspector = page.getByRole("complementary", { name: "Edit the scene" });

  await inspector
    .getByRole("button", { name: /^Modules/u })
    .first()
    .click();
  await inspector
    .getByRole("button", { name: /^Block 1, face 2/u })
    .first()
    .click();
  await page
    .getByRole("toolbar", { name: "Actions" })
    .getByRole("button", { name: "Fill" })
    .click();
  await inspector.getByText("16 modules placed").waitFor();
}

/** What the page reported while both screens ran: its errors, and three.js's warning that a
 * second copy of it loaded. */
async function browse(url: string): Promise<string[]> {
  const browser = await chromium.launch();
  const problems: string[] = [];

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

    page.setDefaultTimeout(60_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright's error.
    page.on("pageerror", (error) => problems.push(String(error)));
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright's message.
    page.on("console", (message) => {
      if (message.type() === "error" || message.text().includes("Multiple instances")) {
        problems.push(message.text());
      }
    });

    await twoViews(page, url);
    await edit(page, url);
  } finally {
    await browser.close();
  }

  return problems;
}

/** Installs, checks, builds and runs the consumer staged in `consumer`; throws at the first fault. */
async function consume(consumer: string): Promise<void> {
  // The packages' generated files exist before the install: Bun links each file it finds then.
  await step(["bun", "run", "shared"], consumer);
  await step(["bun", "install"], consumer);
  await step(["bun", "run", "check"], consumer);
  await step(["bun", "run", "build", "--sourcemap"], consumer);

  const found = strays(
    bundled(join(consumer, ".svelte-kit/output/client")),
    join(consumer, "node_modules"),
    versionAt,
  );

  if (found.length > 0)
    throw new Error(`packages read twice or from outside:\n${found.join("\n")}`);

  const server = serve(join(consumer, "build"));

  try {
    const problems = await browse(server.url.href);

    if (problems.length > 0) throw new Error(`the page reported:\n${problems.join("\n")}`);
  } finally {
    await server.stop(true);
  }
}

if (import.meta.main) {
  const root = new URL("..", import.meta.url).pathname.replace(/\/$/u, "");
  const beside = await stage(root);

  try {
    await consume(join(beside, "consumer"));
  } finally {
    await rm(beside, { recursive: true, force: true });
  }
}

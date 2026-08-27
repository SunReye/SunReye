/**
 * Gate the static SvelteKit build before the server binary embeds it.
 *
 * The build is embedded whole by `bun build --compile --asset ../web/build`, so
 * there is no pack step left — but two things still have to be true of the
 * directory, and both are silent failures if they are not.
 *
 * Runs as part of `bun run build:static`.
 */
import { bakedPublicEnv } from "../../../scripts/static-build-env";

const buildDir = new URL("../build/", import.meta.url);
const file = (relative: string) => Bun.file(new URL(relative, buildDir));

if (!(await file("index.html").exists())) {
  throw new Error("No index.html in apps/web/build — run the static build first");
}

// adapter-static freezes PUBLIC_* into _app/env.js at build time. Baking a
// PUBLIC_SERVER_URL would send every API call and the live socket to whatever
// host the build machine had configured — see scripts/static-build-env.ts.
const envModule = file("_app/env.js");
const baked = (await envModule.exists()) ? bakedPublicEnv(await envModule.text()) : [];
if (baked.length > 0) {
  throw new Error(
    `Refusing to ship the build: it baked public env (${baked.join(", ")}). ` +
      "Unset it (usually apps/web/.env) and rebuild — the embedded dashboard is " +
      "served same-origin and derives its API base from the document URL.",
  );
}

let count = 0;
for await (const _ of new Bun.Glob("**/*").scan({ cwd: Bun.fileURLToPath(buildDir) })) count++;
console.log(`Static build looks embeddable: ${count} files in apps/web/build`);

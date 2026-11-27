// The one compile of the builder's messages (ADRs 11, 25): Home's i18n script and `bun test` run it,
// and a consumer that installs the package by path runs it before building. The project loads the
// message format plugin by path from node_modules, so the compile needs no network.
import { compile } from "@inlang/paraglide-js";
import { compileIfStale } from "./i18n-compile.ts";

const builder = new URL("..", import.meta.url).pathname;

await compileIfStale({
  root: builder,
  outdir: `${builder}src/paraglide`,
  outputs: ["messages.js", "messages.d.ts", "runtime.js", "runtime.d.ts"],
  // The lockfile: a Paraglide upgrade compiles again.
  extra: [
    new URL(import.meta.url).pathname,
    new URL("../../../bun.lock", import.meta.url).pathname,
  ],
  compile: async () => {
    await compile({
      project: `${builder}project.inlang`,
      outdir: `${builder}src/paraglide`,
      // Where Home keeps its choice (ADR 11): the builder speaks the page's language unwired.
      strategy: ["localStorage", "baseLocale"],
      emitReadme: false,
      // Ignored by the repository's own `.gitignore`: one written beside it would keep it out of the
      // packed package too.
      emitGitIgnore: false,
      emitPrettierIgnore: false,
      // Typed for a consumer that, as this repository's root, does not read JavaScript for types.
      emitTsDeclarations: true,
      // One module per locale, as Home's: a module per message makes each browser test fetch hundreds.
      outputStructure: "locale-modules",
    });
  },
});

// The one compile of the messages (ADR 11): the build, check and test scripts run it, and
// `bun test` preloads it, so no step reads stale translations. The project loads the message
// format plugin by path from node_modules, so the compile needs no network.
import { compile } from "@inlang/paraglide-js";
import { compileIfStale } from "../../../../packages/builder/scripts/i18n-compile.ts";

const web = new URL("..", import.meta.url).pathname;

await compileIfStale({
  root: web,
  outdir: `${web}src/lib/paraglide`,
  outputs: ["messages.js", "runtime.js"],
  extra: [new URL(import.meta.url).pathname],
  compile: async () => {
    await compile({
      project: `${web}project.inlang`,
      outdir: `${web}src/lib/paraglide`,
      // A choice outlives a reload; no prefix in the path, so the hash router and ingress hold.
      strategy: ["localStorage", "baseLocale"],
      emitReadme: false,
      // One module per locale: a module per message made each browser test file fetch ~1000, and
      // Chromium holds a handle per fetch until a GC, so a long session ran out of them (#729).
      outputStructure: "locale-modules",
    });
  },
});

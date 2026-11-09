// The one compile of the messages (ADR 11): the build, check and test scripts run it, and
// `bun test` preloads it, so no step reads stale translations. The project loads the message
// format plugin by path from node_modules, so the compile needs no network.
import { compile } from "@inlang/paraglide-js";

const web = new URL("..", import.meta.url).pathname;

await compile({
  project: `${web}project.inlang`,
  outdir: `${web}src/lib/paraglide`,
  // A choice outlives a reload; no prefix in the path, so the hash router and ingress hold.
  strategy: ["localStorage", "baseLocale"],
  emitReadme: false,
});

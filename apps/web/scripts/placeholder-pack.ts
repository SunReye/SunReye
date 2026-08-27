/**
 * Create an empty `build.pack` when there is none, so the server's
 * `with { type: "file" }` import resolves on a fresh clone (dev, tests,
 * `tsc -b`). An empty pack unpacks to nothing embedded and the binary boots
 * API-only; `bun run build:static` overwrites it with the real build.
 */
const pack = Bun.file(new URL("../build.pack", import.meta.url));
if (!(await pack.exists())) {
  await Bun.write(pack, new Uint8Array());
  console.log("Created empty apps/web/build.pack placeholder");
}

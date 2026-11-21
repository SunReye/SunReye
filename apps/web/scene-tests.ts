// Component test files that draw the 3D scene, or a page that may: they run one at a time, after
// the rest (vite.config.ts), and the shards share them out by time (scripts/components.ts). A file
// elsewhere that draws with WebGL fails its test (page.setup.ts). That check runs with the test, so
// it cannot see a draw no test reaches, one after a file's last test, or one in a worker.
export const SCENE = [
  "src/routes/**/*.svelte.test.ts",
  "src/lib/builder/**/*.svelte.test.ts",
  "src/lib/scene/**/*.svelte.test.ts",
  "src/lib/live/**/*.svelte.test.ts",
  "src/lib/cars/**/*.svelte.test.ts",
  "src/lib/dashboard/**/*.svelte.test.ts",
  // The layout step loads the builder.
  "src/lib/setup/LayoutStep.svelte.test.ts",
];

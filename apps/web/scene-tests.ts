// Component test files that draw the 3D scene, or a page that may: they run one at a time, after
// the rest (vite.config.ts), and the shards share them out by time (scripts/components.ts).
export const SCENE = [
  "src/routes/**/*.svelte.test.ts",
  "src/lib/builder/**/*.svelte.test.ts",
  "src/lib/scene/**/*.svelte.test.ts",
  "src/lib/live/**/*.svelte.test.ts",
  "src/lib/cars/**/*.svelte.test.ts",
  "src/lib/dashboard/**/*.svelte.test.ts",
];

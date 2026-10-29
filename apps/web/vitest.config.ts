import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { paraglideOptions } from "./i18n.config";

/**
 * Component layer: a real `.svelte` component mounted in real Chromium.
 *
 * Runes run here — they do not under `bun test` — so this is where a claim about
 * what a component RENDERS or how it REACTS to a click lives, instead of a regex
 * over its source. Files are `*.svelte.test.ts`, colocated with the component;
 * `bun test` skips that suffix (`--path-ignore-patterns` in the test scripts).
 * See apps/web/TESTING.md, "Which layer does this test belong in".
 */
export default defineConfig({
  plugins: [tailwindcss(), paraglideVitePlugin(paraglideOptions), sveltekit()],
  test: {
    include: ["src/**/*.svelte.test.ts"],
    setupFiles: ["./src/component-test-setup.ts"],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }],
    },
  },
});

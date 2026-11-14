// The SPA's built CSS keeps the standard `backdrop-filter` wherever it keeps the prefixed one: the
// minifier folds a pair to whichever comes last, and Chromium ignores the `-webkit-` form, so the
// glass would lose its blur in production alone. A gate step after the build.

import { Glob } from "bun";

const BUILT = "apps/web/build/";

/** The selector of each rule in minified `css` that has `-webkit-backdrop-filter` alone. */
export function unblurred(css: string): string[] {
  const found: string[] = [];

  // A rule's selector runs back from its `{` to the previous `{`, `}` or `;`; its body has no braces.
  for (const match of css.matchAll(/([^{};]+)\{([^{}]*)\}/gu)) {
    const body = match[2] ?? "";

    if (/-webkit-backdrop-filter:/u.test(body) && !/(?<!-webkit-)backdrop-filter:/u.test(body)) {
      found.push((match[1] ?? "").trim());
    }
  }

  return found;
}

if (import.meta.main) {
  const root = new URL("..", import.meta.url).pathname;
  const paths = [...new Glob(`${BUILT}**/*.css`).scanSync(root)].toSorted();

  if (paths.length === 0) {
    process.stderr.write(`No built CSS under ${BUILT}: build the SPA first.\n`);
    process.exitCode = 1;
  }

  const sources = await Promise.all(paths.map((path) => Bun.file(`${root}${path}`).text()));

  const findings = paths.flatMap((path, index) =>
    unblurred(sources[index] ?? "").map((selector) => `${path}: ${selector}`),
  );

  for (const finding of findings) process.stderr.write(`${finding}\n`);

  if (findings.length > 0) {
    process.stderr.write(
      `\n${findings.length} rules keep only -webkit-backdrop-filter: declare it before backdrop-filter.\n`,
    );
    process.exitCode = 1;
  }
}

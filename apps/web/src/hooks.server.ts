// fallow-ignore-file coverage-gaps -- Kit calls `handle` while building; the core's screen tests read its output.
import type { Handle } from "@sveltejs/kit/hooks";

/**
 * Kit 3.1.1 renders the hash router's page with root-absolute asset paths despite
 * `paths.relative`; relative ones keep the SPA working under an ingress prefix (ADR 11).
 */
export function relativeAssets(html: string): string {
  return html.replaceAll('"/_app/', '"./_app/');
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Kit's `Handle` input is mutable.
export const handle: Handle = (input) =>
  input.resolve(input.event, {
    transformPageChunk: (chunk: Readonly<{ html: string }>) => relativeAssets(chunk.html),
  });

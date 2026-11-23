// The builder's host as Home answers it (ADR 25): the core's refusals in the app's words, its toast,
// and the core that stores a car body.
import { provideHost } from "@sunreye/builder/builder/host.ts";
import type { Core } from "../api/core.ts";
import { confirmed } from "../feedback.ts";
import { problemText } from "../i18n/problems.ts";

/** Hosts the builder below the calling component, with the `core` it holds now; call it while that
 * component initialises. */
export function hostIn(core: () => Pick<Core, "uploadCarBody">): void {
  provideHost({
    refusal: (code) => problemText(code),
    confirmed: (text) => {
      confirmed(text);
    },
    uploadCarBody: (glb) => core().uploadCarBody(glb),
  });
}

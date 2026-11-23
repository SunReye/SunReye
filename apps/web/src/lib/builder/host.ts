// The builder's host as Home answers it (ADR 25): the core's refusals in the app's words, its toast,
// the core that stores a car body, and what the builder reads of the core and the live stream.
import type { Host } from "@sunreye/builder";
import type { Core } from "../api/core.ts";
import { confirmed } from "../feedback.ts";
import { problemText } from "../i18n/problems.ts";
import { stream } from "../live/stream.svelte.ts";
import { homeRecords } from "./records.ts";

/** The builder's records and host as Home answers them, through `core`. */
export function homeBuilder(core: Readonly<Core>) {
  return {
    records: { ...homeRecords(core), live: () => stream.values?.devices ?? {} },
    host: {
      refusal: (code) => problemText(code),
      confirmed: (text) => {
        confirmed(text);
      },
      uploadCarBody: (glb) => core.uploadCarBody(glb),
    } satisfies Host,
  };
}

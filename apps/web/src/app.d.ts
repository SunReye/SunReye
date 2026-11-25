declare namespace App {
  interface PageState {
    /** Set on a drill-in level the app pushed, so going back can pop it (ADR 21). */
    readonly drilled?: boolean;
  }
}

/** Svelte's frame loop, which ships no types: the test setup empties it (loop.harness.ts). */
declare module "svelte/internal/client" {
  export const raf: { readonly tasks: Set<unknown> };
}

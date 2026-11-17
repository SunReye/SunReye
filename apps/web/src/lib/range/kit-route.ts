// The range's route through SvelteKit's hash router: the query inside the hash (ADR 11).
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { hashParams, patchHash, type Go } from "./route.svelte.ts";

/** The current hash route's query; a new object only when the route changes. */
export function routeParams(): URLSearchParams {
  return hashParams(page.url);
}

/** Replaces the hash route's query in place, or pushes it for a drill; never scrolls. */
export const routeGo: Go = (patch, push) => {
  void goto(patchHash(page.url, patch), { replace: !push, reset: false });
};

/** One history entry back, as the browser's back does. */
export const routeBack = (): void => {
  history.back();
};

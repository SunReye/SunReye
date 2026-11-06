import { fromStore } from "svelte/store";
import { goto } from "$app/navigation";
import { resolve } from "$lib/resolve";
import { useAppSession } from "$lib/session";
import { firstRunGate } from "$lib/setup";

/**
 * The first-run pages' gate, mirroring the app shell, in its precedence: no session → `/login`; no admin yet
 * → `/onboarding`; with `leaveWhenReady`, an instance that is already configured → `/`. Call during
 * component initialisation.
 */
export function useSetupGate(leaveWhenReady: boolean): void {
  const session = fromStore(useAppSession());
  $effect(() => {
    if (!session.current.isPending && !session.current.data) goto(resolve("/login"));
  });
  $effect(() => {
    if (session.current.isPending || !session.current.data) return;
    firstRunGate().then((g) => {
      if (g === "setup-account") goto(resolve("/onboarding"));
      else if (g === "ready" && leaveWhenReady) goto(resolve("/"));
    });
  });
}

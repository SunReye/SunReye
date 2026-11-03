import { browser } from "$app/environment";
import { resolve, routePath } from "./resolve";

/** Pre-auth pages — never bounce these to login (avoids a redirect loop). */
const PUBLIC_ROUTES = new Set(["/login", "/onboarding", "/setup"]);

/**
 * A 401 means the session expired or was never established (e.g. deleted mid-session).
 * Bounce to login via the ingress-safe resolver so stale-session users aren't left staring
 * at empty states; skip when already on a pre-auth page.
 */
export function bounceOnUnauthorized(response: Response): void {
  if (browser && response.status === 401 && !PUBLIC_ROUTES.has(routePath(new URL(location.href)))) {
    const login = resolve("/login");
    // Loaded on the first expiry only: `$app/navigation` is a Kit virtual module that
    // plain unit tests of the clients cannot resolve.
    void import("$app/navigation").then(({ goto }) => goto(login));
  }
}

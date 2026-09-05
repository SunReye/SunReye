/**
 * What a locked-down engine looks like from the browser when the session goes.
 *
 * Issue #174 made every dashboard read require a session and every
 * configuration read require an admin one. That turns a class of response the
 * app had barely seen — a 401 arriving in the middle of a working page — into
 * an everyday event: a session expires, an admin revokes an account, the server
 * restarts with a new secret. The client's answer is a single Eden `onResponse`
 * hook in `src/lib/api.ts`.
 *
 * Two things are being proven here, and only one of them is "it redirects":
 *
 *  1. The bounce happens at all, driven by the RESPONSE rather than by the
 *     shell's session gate. The mock keeps serving the cached session from
 *     `/api/auth/get-session` precisely so the gate stays satisfied; if the
 *     hook were removed, the page would sit on a dashboard of empty states with
 *     no indication that anything is wrong. That is the failure this replaces.
 *
 *  2. It goes through `$lib/resolve`, i.e. it stays IN the document. Kit's own
 *     `resolve()` builds `${base}#${path}`, and under Home Assistant ingress
 *     `base` loses the document's trailing slash, so the hash router treats the
 *     result as an external URL (sveltejs/kit#14894) and performs a full-page
 *     navigation to a URL the Supervisor answers with a plain 404. A logged-out
 *     ingress user would land on a Home Assistant error page instead of the
 *     login form. A sentinel planted on `window` is what tells the two apart:
 *     it survives a hash navigation and cannot survive a document load.
 *
 * Neither is reachable from a unit test: both only exist while a document is
 * running, and a source-text assertion over `resolve(` would pass for a build
 * that never redirects at all.
 */

import { expect, test } from "@playwright/test";
import { mockBackend } from "./support/api-mock";

/** Survives a hash navigation; cannot survive a document load. */
const plantSentinel = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    (window as unknown as { __sunreyeDocument?: string }).__sunreyeDocument = "same-document";
  });

const sentinel = (page: import("@playwright/test").Page) =>
  page.evaluate(
    () => (window as unknown as { __sunreyeDocument?: string }).__sunreyeDocument ?? null,
  );

const hash = (page: import("@playwright/test").Page) => new URL(page.url()).hash;

test("a 401 mid-session bounces to login, in the same document", async ({ page }) => {
  const backend = await mockBackend(page);
  // Warm /#/history BEFORE the sentinel is planted. The dev server reloads the
  // document the first time a route pulls in a dependency it has not
  // pre-bundled (`[vite] optimized dependencies changed`), and that reload is
  // the harness, not the app — planting the sentinel after it is what keeps
  // this spec about the redirect.
  await page.goto("/#/history");
  await backend.waitForLive();
  await page.evaluate(() => {
    location.hash = "#/";
  });
  await page.waitForTimeout(500);
  await plantSentinel(page);

  // The session is gone server-side; the client does not know yet.
  backend.expireSession();
  // Provoke a read. Any route change does — this one is a page whose data all
  // comes from the endpoints that just started refusing.
  await page.evaluate(() => {
    location.hash = "#/history";
  });

  await expect.poll(() => hash(page), { timeout: 15_000 }).toBe("#/login");
  expect(await sentinel(page)).toBe("same-document");
});

test("a stale session does not bounce a page that is already pre-auth", async ({ page }) => {
  // The redirect loop this guards: /#/login itself reads nothing privileged, but
  // anything on the page that does would otherwise bounce it back to where it
  // already is, forever.
  const backend = await mockBackend(page, { role: null });
  await page.goto("/#/login");
  await plantSentinel(page);
  backend.expireSession();

  await page.waitForTimeout(2000);
  expect(hash(page)).toBe("#/login");
  expect(await sentinel(page)).toBe("same-document");
});

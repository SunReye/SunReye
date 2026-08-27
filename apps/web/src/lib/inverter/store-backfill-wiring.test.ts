/**
 * The one thing about `InverterStore#backfill` that a unit test cannot reach:
 * that it reads the buffers UNTRACKED.
 *
 * `newestHeldMs()` walks the `SvelteMap` of per-metric buffers to size the next
 * request. `MetricsFeed.lease()` calls `#backfill()` synchronously from inside
 * the shell's `$effect` in `(app)/+layout.svelte` — the await chain has not
 * suspended by the time that line runs — so a TRACKED read there makes the
 * effect depend on the very map that `seedBackfill`/`mergeBackfill` and every
 * live frame go on to write.
 *
 * That shipped once, and the failure was total rather than subtle: the effect
 * invalidated on its own write, its cleanup released the socket and the metrics
 * lease, it re-ran, re-leased, re-fetched and wrote again — about twelve cycles
 * a second of `/api/profile` + `/api/history/recent`, a WebSocket closed before
 * it finished opening, and `MetricsFeed`'s `#consuming` flag never latching, so
 * not one live frame was applied and every reading on the dashboard rendered as
 * an em dash. The server was healthy throughout.
 *
 * THE REAL COVERAGE IS `apps/web/e2e/shell-lease-loop.spec.ts`. That spec boots
 * the app in a browser and asserts the four things a user actually saw — boot
 * calls after settling (0, was ~400 in three seconds), socket opens (1, was
 * hundreds), `unsub` frames (0), and that a power-flow readout holds a number
 * instead of an em dash. It has been watched fail against the pre-fix store and
 * it does not care how the fix is spelled. Fix a bug of this shape and cover it
 * THERE; `scripts/require-tests.ts` counts an e2e spec as a test for exactly
 * this reason.
 *
 * This file is kept anyway, deliberately, as a canary rather than as proof:
 *
 *   - it costs ~0.2ms inside a 7s suite that runs on every commit, where the
 *     browser suite is ~70s and a separate CI job — so it is what catches an
 *     "it's only a refactor" edit to this method before it reaches a push;
 *   - when it goes red it names the one line to look at, where the browser spec
 *     tells you the app is broken and leaves you to bisect. Cheap localisation
 *     next to expensive truth is the point of having both.
 *
 * Read the limits honestly, because a source-text test invites the wrong
 * lesson. It PASSES for code that is broken: any other reactive read added to
 * `#backfill` reintroduces the loop with the `untrack(...)` still present. It
 * FAILS for code that is fine: a rename, a reformat, or moving the read one
 * frame earlier. It pins a token, not a behaviour, and a green here means
 * "nobody deleted the fix", never "the shell does not loop". If this file and
 * the browser spec ever disagree, the browser spec is right.
 *
 * See apps/web/TESTING.md, "Which layer does this test belong in".
 */

import { describe, expect, test } from "bun:test";

const STORE = new URL("./store.svelte.ts", import.meta.url);
const source = await Bun.file(STORE).text();

/**
 * Source with block and line comments removed, so an assertion about what the
 * store DOES cannot be satisfied — or tripped — by prose that mentions it. This
 * file's own explanation names both `untrack` and `newestHeldMs`, and so does
 * the comment beside the call, so stripping is what keeps the test honest.
 * (`//` preceded by `:` is left alone — that is a URL, not a comment.)
 */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const code = stripComments(source);

describe("canary: the untrack around the backfill's buffer read is still there", () => {
  test("newestHeldMs is read inside untrack", () => {
    // The arrow is the point: `untrack` takes a thunk, so `untrack(this.#live
    // .newestHeldMs())` would evaluate the read tracked and hand untrack the
    // number. Pin the callback form.
    expect(code).toMatch(/untrack\(\s*\(\)\s*=>\s*this\.#live\.newestHeldMs\(\)\s*\)/);
  });

  test("no bare newestHeldMs call escapes the untrack", () => {
    const calls = code.match(/newestHeldMs\(\)/g) ?? [];
    const untracked =
      code.match(/untrack\(\s*\(\)\s*=>\s*this\.#live\.newestHeldMs\(\)\s*\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    expect(untracked.length).toBe(calls.length);
  });

  test("untrack is imported from svelte, not shadowed by a local", () => {
    expect(code).toMatch(/import\s*\{[^}]*\buntrack\b[^}]*\}\s*from\s*["']svelte["']/);
    expect(code).not.toMatch(/(?:const|let|var|function)\s+untrack\b/);
  });
});

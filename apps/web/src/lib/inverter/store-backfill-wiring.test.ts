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
 * Runes do not run under `bun test` and there is no render harness (see
 * apps/web/TESTING.md), so the store shell can only be pinned by reading it.
 * This is a source-text assertion, so it pins the LOAD-BEARING TOKEN only: the
 * read must sit inside an `untrack(...)`, whatever else moves around it.
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

describe("the backfill sizes itself without subscribing to the buffers", () => {
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

/**
 * Which of the two full-screen mechanisms a chart gets, and how the native one
 * is reached across the two vendor spellings still in the wild.
 *
 * Two mechanisms because one of them is missing on the browser this app is most
 * often read on: Safari on iPhone implements `Element.requestFullscreen` on
 * nothing but `<video>`, so a chart that only knew the standard API would have a
 * button that does nothing at all there. The fallback is a fixed overlay, which
 * costs the browser chrome's height and nothing else.
 *
 * And WHICH element is handed to the browser is the load-bearing case below —
 * see `fullscreenTarget`.
 *
 * All of it is decided here rather than in the component: a `.svelte` file
 * cannot be exercised under `bun test` (see apps/web/TESTING.md), and "did we
 * pick the fallback on the one browser that needs it" is exactly the question a
 * source-text test cannot answer.
 */

import { describe, expect, test } from "bun:test";
import {
  activeFullscreenElement,
  escapeClosesOverlay,
  exitFullscreen,
  fullscreenMode,
  fullscreenTarget,
  requestFullscreen,
  type FullscreenCapableDocument,
  type FullscreenCapableElement,
} from "./fullscreen";

/** An element that implements the standard API. */
function standardElement(): FullscreenCapableElement {
  return { requestFullscreen: () => Promise.resolve() };
}

/** WebKit's prefixed spelling — iPad Safari and older desktop Safari. */
function webkitElement(): FullscreenCapableElement {
  return { webkitRequestFullscreen: () => undefined };
}

describe("fullscreenMode", () => {
  test("uses the native API when the element implements the standard one", () => {
    expect(fullscreenMode(standardElement())).toBe("native");
  });

  test("uses the native API through WebKit's prefixed spelling too", () => {
    // The prefixed method is synchronous and returns `undefined`, where the
    // standard one returns a promise — a caller that awaited unconditionally
    // would be awaiting `undefined`, which is fine, but only because the call
    // itself already happened.
    expect(fullscreenMode(webkitElement())).toBe("native");
  });

  test("falls back to the overlay when neither exists", () => {
    // The iPhone case. Not a failure to handle — the chart still fills the
    // screen, it just keeps the browser's own chrome above it.
    expect(fullscreenMode({})).toBe("overlay");
  });

  test("treats a missing element as the overlay case", () => {
    // The wrapper binds its box with `bind:this`, which is `null` until mount;
    // asking before then must not throw, and must not claim native support the
    // element may not have.
    expect(fullscreenMode(null)).toBe("overlay");
  });

  test("does not mistake a non-callable property for support", () => {
    // Guarding on `"requestFullscreen" in el` would call a property that is not
    // a function and throw inside the click handler, leaving the chart in
    // neither state.
    expect(fullscreenMode({ requestFullscreen: undefined })).toBe("overlay");
    expect(fullscreenMode({ webkitRequestFullscreen: undefined })).toBe("overlay");
  });
});

describe("activeFullscreenElement", () => {
  test("reads the standard property", () => {
    const el = standardElement();
    expect(activeFullscreenElement({ fullscreenElement: el } as FullscreenCapableDocument)).toBe(
      el,
    );
  });

  test("reads WebKit's prefixed property", () => {
    const el = webkitElement();
    expect(
      activeFullscreenElement({ webkitFullscreenElement: el } as FullscreenCapableDocument),
    ).toBe(el);
  });

  test("is null when nothing is full-screen", () => {
    // Both properties are `null` (not absent) in every browser that has them,
    // so the falsy check has to survive an explicit null on the standard one
    // while the prefixed one is missing entirely.
    expect(activeFullscreenElement({ fullscreenElement: null })).toBe(null);
    expect(activeFullscreenElement({})).toBe(null);
  });

  test("survives a document that has neither property", () => {
    // Server-side render and the test runner both get here.
    expect(activeFullscreenElement(null)).toBe(null);
  });
});

describe("requestFullscreen", () => {
  test("prefers the standard method when both are present", async () => {
    const called: string[] = [];
    const el: FullscreenCapableElement = {
      requestFullscreen: () => {
        called.push("standard");
        return Promise.resolve();
      },
      webkitRequestFullscreen: () => called.push("webkit"),
    };
    expect(await requestFullscreen(el)).toBe(true);
    expect(called).toEqual(["standard"]);
  });

  test("falls through to the prefixed method", async () => {
    const called: string[] = [];
    expect(await requestFullscreen({ webkitRequestFullscreen: () => called.push("webkit") })).toBe(
      true,
    );
    expect(called).toEqual(["webkit"]);
  });

  test("reports failure rather than throwing when the browser refuses", async () => {
    // `requestFullscreen` rejects when it is not called from a user gesture, and
    // Chrome rejects it outright inside a cross-origin iframe — which is how
    // this app runs under Home Assistant ingress. An unhandled rejection there
    // would leave the button dead AND log an error on every tap; instead the
    // caller gets `false` and opens the overlay.
    const el = { requestFullscreen: () => Promise.reject(new Error("not allowed")) };
    expect(await requestFullscreen(el)).toBe(false);
  });

  test("reports failure when the prefixed method throws synchronously", async () => {
    const el = {
      webkitRequestFullscreen: () => {
        throw new Error("nope");
      },
    };
    expect(await requestFullscreen(el)).toBe(false);
  });

  test("reports failure when there is no method at all", async () => {
    expect(await requestFullscreen({})).toBe(false);
    expect(await requestFullscreen(null)).toBe(false);
  });
});

describe("exitFullscreen", () => {
  test("does nothing when no element holds the screen", async () => {
    // Escape already exited, or the chart was never native in the first place.
    // Calling `exitFullscreen()` with nothing full-screen rejects with a
    // TypeError in Chrome, so the guard is the whole point of the function.
    let called = 0;
    await exitFullscreen({
      fullscreenElement: null,
      exitFullscreen: () => {
        called++;
        return Promise.resolve();
      },
    });
    expect(called).toBe(0);
  });

  test("exits through the standard method", async () => {
    let called = 0;
    await exitFullscreen({
      fullscreenElement: standardElement(),
      exitFullscreen: () => {
        called++;
        return Promise.resolve();
      },
    });
    expect(called).toBe(1);
  });

  test("exits through WebKit's prefixed method", async () => {
    let called = 0;
    await exitFullscreen({
      webkitFullscreenElement: webkitElement(),
      webkitExitFullscreen: () => called++,
    });
    expect(called).toBe(1);
  });

  test("swallows a rejection rather than leaving it unhandled", async () => {
    // The page is either in the state we wanted or not; there is nothing the
    // caller could do differently, and an unhandled rejection would surface as
    // a console error every time a chart closes.
    await exitFullscreen({
      fullscreenElement: standardElement(),
      exitFullscreen: () => Promise.reject(new Error("nope")),
    });
    expect(true).toBe(true);
  });

  test("survives a document that has neither method", async () => {
    await exitFullscreen(null);
    await exitFullscreen({ fullscreenElement: standardElement() });
    expect(true).toBe(true);
  });
});

describe("fullscreenTarget", () => {
  test("is the document element, never the card that asked", () => {
    // The bug this exists to prevent: in native full screen the browser renders
    // only the full-screen element's subtree, and every popup in this app —
    // layerchart's tooltip, bits-ui's dropdown/select/popover content — is
    // portalled to `document.body`. Full-screening the chart's own card put all
    // of them outside the rendering tree: tooltips vanished and menus opened
    // invisibly, so the controls read as broken.
    //
    // The card is made to fill the screen by a fixed overlay either way, so
    // handing the browser `<html>` costs nothing and keeps the whole document
    // rendered.
    const documentElement = { requestFullscreen: () => Promise.resolve() };
    const card = { requestFullscreen: () => Promise.resolve() };
    expect(fullscreenTarget({ documentElement })).toBe(documentElement);
    expect(fullscreenTarget({ documentElement })).not.toBe(card);
  });

  test("is null when there is no document", () => {
    // Server-side render and the test runner both get here; the caller then
    // takes the overlay, which needs no element at all.
    expect(fullscreenTarget(null)).toBe(null);
    expect(fullscreenTarget({})).toBe(null);
  });
});

describe("escapeClosesOverlay", () => {
  // Escape has to mean "close the thing on top". When the browser is holding
  // full screen for us it owns the key and we must not also act on it. When it
  // is not — iPhone Safari, or the cross-origin ingress iframe, where the card
  // is only a fixed overlay — Escape is the ONLY way back out, so we do act on
  // it. Unless something is open above the card, in which case that layer is
  // what the user meant to dismiss.

  test("closes the card when nothing else is open and we own the key", () => {
    expect(escapeClosesOverlay("Escape", false, false)).toBe(true);
  });

  test("leaves the key to the browser while it is holding full screen", () => {
    // Acting here would exit full screen AND collapse the card on one press,
    // and the `fullscreenchange` listener already collapses it.
    expect(escapeClosesOverlay("Escape", true, false)).toBe(false);
  });

  test("dismisses an open layer instead of the card underneath it", () => {
    // The draft picker is a dropdown ON the expanded card. Without this, one
    // Escape closes the picker and throws the user out of full screen at the
    // same time, losing the draft they were building.
    expect(escapeClosesOverlay("Escape", false, true)).toBe(false);
  });

  test("ignores every other key", () => {
    // The handler is on `document` for as long as a card is expanded, so it
    // sees everything the user types into the picker's search box.
    for (const key of ["Enter", "Tab", "a", "ArrowDown", "Esc", "escape"]) {
      expect(escapeClosesOverlay(key, false, false)).toBe(false);
    }
  });
});

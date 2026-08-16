import { describe, expect, test } from "bun:test";
import { sectionOpen, slideParams, writesOwnOpen } from "./section-state";

describe("section open state", () => {
  // A non-collapsible section has no trigger, so its content must never be
  // hidden — even if a stale `open={false}` is still bound from a caller that
  // dropped `collapsible`.
  test("a section that cannot collapse is always open", () => {
    expect(sectionOpen({ collapsible: false, open: false })).toBe(true);
    expect(sectionOpen({ collapsible: false, open: undefined })).toBe(true);
  });

  test("a collapsible section starts open — content is the default, not the exception", () => {
    expect(sectionOpen({ collapsible: true, open: undefined })).toBe(true);
  });

  test("a collapsible section obeys the bound state once the viewer has one", () => {
    expect(sectionOpen({ collapsible: true, open: false })).toBe(false);
    expect(sectionOpen({ collapsible: true, open: true })).toBe(true);
  });
});

describe("who owns the open state", () => {
  // The statistics sections compute open as
  // `customize.active || (viewerOpen ?? !collapsed(id))` — a $derived, which
  // cannot be `bind:`-ed. If the section wrote that prop anyway, the write
  // would survive exactly until the caller's next recompute and then snap back.
  test("a controlled section leaves the value to the caller", () => {
    expect(writesOwnOpen(true)).toBe(false);
  });

  // The default: no caller state at all, or a plain `bind:open` persisted as a
  // preference. Nobody else is going to write it, so the section must.
  test("an uncontrolled section owns it, declared or not", () => {
    expect(writesOwnOpen(false)).toBe(true);
    expect(writesOwnOpen(undefined)).toBe(true);
  });
});

describe("collapse motion", () => {
  // Five of the six section variants this replaces animated unconditionally.
  test("reduced motion collapses instantly rather than sliding", () => {
    expect(slideParams(true)).toEqual({ duration: 0 });
  });

  test("everyone else gets the 200ms slide the statistics sections use", () => {
    expect(slideParams(false)).toEqual({ duration: 200 });
  });
});

// The one easing as scripts read it and as the stylesheet writes it (ADR 21): both the same curve.
import { expect, test } from "vitest";
import "../../app.css";
import { MOTION_EASE } from "@sunreye/builder/motion";

test("the motion ease scripts animate with is the stylesheet's", () => {
  const written = getComputedStyle(document.documentElement).getPropertyValue("--motion-ease");

  expect(written.replaceAll(/\s/gu, "")).toBe(MOTION_EASE.replaceAll(/\s/gu, ""));
});

import { afterEach, expect, test } from "vitest";
import { QUALITY, QualityStore } from "./quality.svelte.ts";

const RTX = "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)";

afterEach(() => {
  localStorage.clear();
});

test("a browser starts on Auto: Mittel until a capable GPU is seen, then Hoch", () => {
  const quality = new QualityStore();

  expect(quality.choice).toBe("auto");
  expect(quality.look("full").level).toBe("medium");

  quality.see(RTX);
  expect(quality.look("full").level).toBe("high");
});

test("the GPU seen is kept, so the next visit starts on its level", () => {
  new QualityStore().see(RTX);

  expect(new QualityStore().look("full").level).toBe("high");
});

test("the chosen level is kept per browser", () => {
  const quality = new QualityStore();

  quality.choice = "ultra";

  expect(localStorage.getItem(QUALITY)).toBe("ultra");
  expect(new QualityStore().look("lite").level).toBe("ultra");
});

test("a strain over a drawn scene takes a level off Auto, remembered per browser", () => {
  const quality = new QualityStore();

  quality.see(RTX);

  const hide = quality.show();

  expect(quality.relieve("full")).toBe(true);
  expect(quality.look("full").level).toBe("medium");
  // Mittel is the full tier's floor: the motion tier gives next.
  expect(quality.relieve("full")).toBe(false);
  hide();

  expect(new QualityStore().look("full").level).toBe("medium");
});

test("a strain with no scene on show says nothing about the drawing", () => {
  const quality = new QualityStore();

  quality.see(RTX);

  expect(quality.relieve("full")).toBe(false);
  expect(quality.look("full").level).toBe("high");
});

test("a strain leaves a chosen level alone", () => {
  const quality = new QualityStore();

  quality.choice = "high";
  quality.show();

  expect(quality.relieve("full")).toBe(false);
  expect(quality.look("full").level).toBe("high");
});

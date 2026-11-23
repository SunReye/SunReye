import { afterEach, expect, test } from "vitest";
import { cdp } from "vitest/browser";
import { QUALITY, QualityStore } from "@sunreye/builder/scene/quality.svelte.ts";

const RTX = "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)";

afterEach(async () => {
  localStorage.clear();
  await cdp().send("Emulation.setEmitTouchEventsForMouse", { enabled: false });
  await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: false });
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

  // The frame watch, whose strain it was, dates it.
  localStorage.setItem("sunreye.strained-at", String(Date.now()));
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

test("a level strain took off Auto comes back after seven days", () => {
  const day = 86_400_000;
  const quality = new QualityStore(() => 1000);

  quality.see(RTX);
  quality.show();
  quality.relieve("full");
  localStorage.setItem("sunreye.strained-at", "1000");

  expect(new QualityStore(() => 1000 + 7 * day - 1).look("full").level).toBe("medium");
  expect(new QualityStore(() => 1000 + 7 * day).look("full").level).toBe("high");
});

test("on a touch device Auto starts at Mittel even on a capable GPU, and Hoch stays a choice", async () => {
  const quality = new QualityStore();

  // An iPhone's GPU reads as a desktop Mac's.
  quality.see("Apple GPU");
  expect(quality.look("full").level).toBe("high");

  await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await cdp().send("Emulation.setEmitTouchEventsForMouse", {
    enabled: true,
    configuration: "mobile",
  });
  expect(matchMedia("(pointer: coarse)").matches).toBe(true);

  const phone = new QualityStore();

  expect(phone.look("full")).toMatchObject({ level: "medium", pixelRatio: 1.5, shadowMap: 2048 });
  expect(phone.look("full")).toMatchObject({ contact: false, occluded: 0.75, samples: 8 });

  phone.choice = "high";
  expect(phone.look("full").level).toBe("high");
});

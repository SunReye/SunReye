import "../../app.css";
import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { perf } from "../../../../../../packages/builder/src/scene/perf.svelte.ts";
import { screen as emulate } from "../scene/probe.harness.ts";
import { quality } from "../../../../../../packages/builder/src/scene/quality.svelte.ts";
import { presetView } from "../../../../../../packages/builder/src/builder/camera.ts";
import type { Geometry } from "../../../../../../packages/builder/src/builder/pv.ts";
import { SceneCanvas } from "@sunreye/builder";
import { settle } from "../motion/clock.harness.ts";

// The scene's readout (ADR 21 "Measuring"): asked for with `?perf` on the URL. Asked for once,
// it stays for the page's life, so the scene that shows none is the first here.

const house: Geometry = {
  faces: [
    {
      surface: "roof",
      corners: [
        [0, 0, 3],
        [10, 0, 3],
        [10, -8, 3],
        [0, -8, 3],
      ],
    },
  ],
  solids: [],
};

const shown = () =>
  render(SceneCanvas, {
    geometry: house,
    view: presetView("isometric", house),
    onview: () => {},
  });

afterEach(async () => {
  perf.trial = {};
  quality.choice = "auto";
  history.replaceState(null, "", location.pathname + location.search);
  localStorage.clear();
  await emulate();
});

test("a scene shows no readout unless the URL asks for it", async () => {
  const screen = await shown();

  await expect.element(screen.getByLabelText("3D-Szene des Hauses")).toBeVisible();
  await expect
    .element(screen.getByRole("status", { name: "Leistungsanzeige" }))
    .not.toBeInTheDocument();
});

test("`?perf` lays a readout over the scene: what a frame draws, and what this browser draws with", async () => {
  await emulate(3);
  quality.choice = "high";
  location.hash = "#/?perf";

  const screen = await shown();
  const readout = screen.getByRole("status", { name: "Leistungsanzeige" });
  const told = () => readout.query()?.textContent ?? "";

  await settle(() => /\d+ draws · \d+ tris · \d+ programs/u.test(told()));
  expect(told()).toMatch(/\d+ fps · JS [\d.]+ ms · GPU (?:–|[\d.]+) ms/u);
  expect(told()).toMatch(/DPR 2 ·/u);
  expect(told()).toMatch(/shadow map 4096 · AO on · contact shadows on/u);
  expect(told()).toMatch(/quality high → high · tier full · loop off/u);
  // This host draws in software, and says so.
  expect(told()).toMatch(/swiftshader|llvmpipe|angle/iu);
  expect(told()).toMatch(/3d-strain – · motion-strain –/u);
});

test("the readout's switches try a lighter drawing on this page, and keep nothing", async () => {
  await emulate(3);
  quality.choice = "high";
  location.hash = "#/?perf";

  const screen = await shown();
  const readout = screen.getByRole("status", { name: "Leistungsanzeige" });
  const told = () => readout.query()?.textContent ?? "";

  await settle(() => /AO on · contact shadows on/u.test(told()));

  await screen.getByRole("button", { name: "Umgebungsverdeckung" }).click();
  await screen.getByRole("button", { name: "Kontaktschatten" }).click();
  await settle(() => /AO off · contact shadows off/u.test(told()));
  // The scene, and the picture onto the canvas: no pass of the occlusion's is left.
  await settle(() => /canvas \d+×\d+ · [23] passes/u.test(told()));

  await screen.getByRole("group", { name: "Pixelverhältnis" }).getByText("1.5").click();
  await settle(() => /DPR 1\.5 ·/u.test(told()));

  await screen.getByRole("group", { name: "Schattenkarte" }).getByText("1024").click();
  await settle(() => /shadow map 1024 ·/u.test(told()));

  expect(quality.choice).toBe("high");
  expect(localStorage.getItem("sunreye.3d-quality")).toBe("high");
});

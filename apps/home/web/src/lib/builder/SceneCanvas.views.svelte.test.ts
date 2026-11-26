import "../../app.css";
import { expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { presetView } from "../../../../../../packages/builder/src/builder/camera.ts";
import type { Geometry } from "../../../../../../packages/builder/src/builder/pv.ts";
import { SceneCanvas } from "@sunreye/builder";
import { settle } from "../motion/clock.harness.ts";

// Each canvas is a studio of its own (ADR 25): a consumer may show one scene twice.

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

test("one scene shows in two canvases at once, from above and at an angle, each drawn", async () => {
  const ready = { top: vi.fn(), isometric: vi.fn() };

  await Promise.all(
    (["top", "isometric"] as const).map((preset) =>
      render(SceneCanvas, {
        geometry: house,
        view: presetView(preset, house),
        onview: () => {},
        onready: ready[preset],
        label: preset,
      }),
    ),
  );

  await settle(() => ready.top.mock.calls.length === 1 && ready.isometric.mock.calls.length === 1);
  await expect.element(page.getByLabelText("top")).toBeVisible();
  await expect.element(page.getByLabelText("isometric")).toBeVisible();
});

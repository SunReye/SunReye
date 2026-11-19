import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import CameraLock from "../dashboard/CameraLock.svelte";
import ViewToggle from "../dashboard/ViewToggle.svelte";
import { PLANT } from "../api/core.ts";
import { least, still } from "../contrast.harness.ts";
import { chip, frame, show } from "./live-scene.harness.ts";
import { feed } from "./stream.harness.ts";

// Canvas chips (ADR 21 "Glass"): what floats over the 3D canvas has no backdrop blur, which the
// browser would make again for every frame the canvas draws, and stays readable without it.

afterEach(() => {
  document.documentElement.classList.remove("dark");
  still.remove();
});

const blur = (element: Element): string => getComputedStyle(element).backdropFilter;

test("a live label over the scene has no backdrop blur", async () => {
  const tick = feed();

  await show();
  tick(frame(600, -1200));

  expect(blur((await chip("Süd", "600")).element())).toBe("none");
  expect(blur((await chip("Netz", "1,2")).element())).toBe("none");
});

test("a label's text holds AA over the darkest and the brightest a scene can show, in both themes", async () => {
  const tick = feed();

  await show();
  tick({
    devices: { "1": { "pv.string.power[11]": 600, "pv.power": 600 }, [PLANT]: { "grid.power": 0 } },
  });

  const label = (await chip("Süd", "600")).element();
  const name = label.querySelector(".text-muted-foreground");

  if (name === null) throw new TypeError("the chip has no name");

  document.head.append(still);

  for (const theme of ["light", "dark"]) {
    document.documentElement.classList.toggle("dark", theme === "dark");

    for (const text of [label, name]) {
      expect([theme, least(text, label) >= 4.5]).toEqual([theme, true]);
    }
  }
});

test("the camera lock and the view toggle over the scene have no backdrop blur either", async () => {
  const lock = await render(CameraLock, { locked: true });

  expect(blur(lock.getByRole("button", { name: "Kamera bewegen" }).element())).toBe("none");

  const toggle = await render(ViewToggle, {
    shows: "3d",
    toggles: true,
    build: false,
    onchoose: () => {},
  });

  expect(blur(toggle.getByRole("group", { name: "Ansicht" }).element())).toBe("none");
});

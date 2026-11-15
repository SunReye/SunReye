import "../../../app.css";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { connect } from "../../api/core.ts";
import Builder from "../Builder.svelte";
import {
  DEVICES,
  desk,
  drill,
  house,
  inspector,
  MODULE,
  onCanvas,
  press,
  pv,
  testCore,
  undesk,
} from "../builder.harness.ts";
import { addGrid } from "../modules.ts";
import { place } from "../placing.ts";
import { handles } from "./grips.ts";

const SLOW = { timeout: 15_000 };

beforeEach(async () => {
  localStorage.removeItem("sunreye.builder.view");
  await desk();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await undesk();
});

/** The house with a chimney on its south face, 3 m across and 1.5 m up it, and two modules east
 * of it: 4.5 m and 7 m across. */
function start() {
  const draft = house();
  const chimney = { block: 0, face: 1, across: 3, up: 1.5, width: 0.6, depth: 0.6, height: 1.2 };

  const scene = place(addGrid(draft.scene, 0, 1, MODULE.id), 0, [
    { across: 4.5, up: 0.5, landscape: false },
    { across: 7, up: 0.5, landscape: false },
  ]);

  return { ...draft, scene: { ...scene, chimneys: [chimney] } };
}

/** The root level's count of modules. */
const modules = (count: number) =>
  inspector().getByText(`Module: ${count} · ohne String: ${count}`, { exact: true });

test("a chimney dragged onto a module removes it, in the drag's undo step", SLOW, async () => {
  const draws = vi.spyOn(EffectComposer.prototype, "render");
  const draft = start();
  const [top] = handles(draft.scene, { kind: "chimney", index: 0 }, pv.modules(draft.scene, {}));

  if (top === undefined) throw new Error("no chimney handle");

  await render(Builder, {
    pv,
    core: connect(testCore()),
    start: draft,
    moduleTypes: [MODULE],
    devices: DEVICES,
  });
  await expect.poll(() => draws.mock.calls.length, SLOW).toBeGreaterThan(0);
  await expect.element(modules(2)).toBeVisible();

  const onPage = onCanvas(draft.scene);
  const [x, y, z] = top.at;

  await press("mouse", [onPage(top.at)]);
  await expect.element(inspector().getByRole("heading", { name: "Schornstein 1" })).toBeVisible();

  // 2 m east: 5 m across, on the first module, which spans 4.5 m to 5.634 m.
  await press("mouse", [onPage(top.at), onPage([x + 1, y, z]), onPage([x + 2, y, z])]);
  await drill("Gebäude", "Szene");
  await expect.element(modules(1)).toBeVisible();

  await inspector().getByRole("button", { name: "Rückgängig" }).click();
  await expect.element(modules(2)).toBeVisible();
});

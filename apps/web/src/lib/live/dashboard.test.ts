/// <reference types="bun" />
import { expect, test } from "bun:test";
import { connect } from "../api/core.ts";
import { dashboard, keptChoice, sceneLayout } from "./dashboard.ts";

const able = { scene: true, webgl2: true, lowPower: false, choice: null } as const;

test("with a scene and WebGL2 the dashboard opens on the 3D scene, and may switch to 2D", () => {
  expect(dashboard(able)).toEqual({ shows: "3d", toggles: true });
  expect(dashboard({ ...able, choice: "2d" })).toEqual({ shows: "2d", toggles: true });
});

test("without a scene, without WebGL2 or with the low-power switch on, the 2D flow shows", () => {
  for (const lacking of [{ scene: false }, { webgl2: false }, { lowPower: true }]) {
    expect(dashboard({ ...able, choice: "3d", ...lacking })).toEqual({
      shows: "2d",
      toggles: false,
    });
  }
});

test("a toggle kept as anything else is no choice", () => {
  expect([keptChoice("2d"), keptChoice("3d"), keptChoice("flat"), keptChoice(null)]).toEqual([
    "2d",
    "3d",
    null,
    null,
  ]);
});

/** A core that answers every request with `answer`, or fails when there is none. */
function serving(answer?: string) {
  return connect({
    base: "http://core.test/",
    fetch: () =>
      answer === undefined
        ? Promise.reject(new TypeError("offline"))
        : Promise.resolve(
            new Response(answer, { headers: { "content-type": "application/json" } }),
          ),
  });
}

test("only a layout with a scene opens the 3D scene; none, a refusal or no core opens none", async () => {
  const scene = { north: 0, blocks: [], obstacles: [] };
  const layout = { appliesFrom: "2026-11-01T00:00:00Z", strings: [], warnings: [] };

  expect(await sceneLayout(serving(JSON.stringify({ ...layout, scene })))).toEqual({
    ...layout,
    scene,
  });
  expect(await sceneLayout(serving(JSON.stringify(layout)))).toBeNull();
  expect(await sceneLayout(serving())).toBeNull();
});

/// <reference types="bun" />
// Where the builder draws its first block's width arrow, and a point two metres outward: the
// handle drag's path in page pixels, seen from the builder's first view, the isometric preset.

import { PerspectiveCamera, Vector3 } from "three";
import type { Page } from "playwright";
import { presetView } from "../src/lib/builder/camera.ts";
import { handles } from "../src/lib/builder/handles/grips.ts";
import { loadPv, type Scene } from "../src/lib/builder/pv.ts";
import { SCENE } from "./fixtures.ts";
import type { Pixel } from "./gestures.ts";

const WASM = new URL(
  "../../../target/wasm32-unknown-unknown/release/sunreye_pv_wasm.wasm",
  import.meta.url,
);

export async function aim(page: Page): Promise<readonly [Pixel, Pixel]> {
  const pv = await loadPv(new Uint8Array(await Bun.file(WASM).arrayBuffer()));
  const scene: Scene = SCENE;
  const canvas = await page.getByLabel("3D-Szene des Hauses").boundingBox();
  const arrow = handles(scene, { kind: "block", index: 0 }).find(({ grip }) => grip === "width");

  if (canvas === null || arrow?.axis === undefined) throw new Error("no canvas or no width arrow");

  const view = presetView("isometric", pv.geometry(scene));
  const camera = new PerspectiveCamera(40, canvas.width / canvas.height, 0.1, 5000);

  camera.position.set(...view.position);
  camera.lookAt(...view.target);
  camera.updateMatrixWorld();

  const onPage = ([x, y, z]: readonly [number, number, number]): Pixel => {
    const at = new Vector3(x, y, z).project(camera);

    return [
      canvas.x + ((at.x + 1) / 2) * canvas.width,
      canvas.y + ((1 - at.y) / 2) * canvas.height,
    ];
  };

  const [ax, ay, az] = arrow.at;

  return [onPage(arrow.at), onPage([ax + arrow.axis[0] * 2, ay, az + arrow.axis[2] * 2])];
}

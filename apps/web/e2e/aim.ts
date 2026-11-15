/// <reference types="bun" />
// Where the builder draws a handle of its first block, of a window added to it or of a chimney
// added to its roof, and a point two metres on: the handle drag's path in page pixels, seen from
// the builder's first view, the isometric preset.

import { PerspectiveCamera, Vector3 } from "three";
import type { Page } from "playwright";
import { presetView } from "../src/lib/builder/camera.ts";
import { chimney } from "../src/lib/builder/draft.ts";
import { handles, type Handle, type Target } from "../src/lib/builder/handles/grips.ts";
import { loadPv, type Scene } from "../src/lib/builder/pv.ts";
import { fresh } from "../src/lib/builder/wall-openings.ts";
import { SCENE } from "./fixtures.ts";
import type { Pixel } from "./gestures.ts";

const WASM = new URL(
  "../../../target/wasm32-unknown-unknown/release/sunreye_pv_wasm.wasm",
  import.meta.url,
);

/** What a journey drags: the fixture's block, or what its `ready` added through the inspector. */
export type Aimed = "block" | "window" | "chimney";

const GRIP = { block: "width", window: "width", chimney: "move" } as const;

type Triple = readonly [number, number, number];

export async function aim(page: Page, aimed: Aimed = "block"): Promise<readonly [Pixel, Pixel]> {
  const pv = await loadPv(new Uint8Array(await Bun.file(WASM).arrayBuffer()));
  const plain: Scene = SCENE;
  const { roofs } = pv.modules(plain, {});
  const [face] = roofs;
  const made = fresh(plain, "window");

  if (face === undefined || made === null) throw new Error("no roof face or no room for a window");

  const scenes: Readonly<Record<Aimed, readonly [Scene, Target]>> = {
    block: [plain, { kind: "block", index: 0 }],
    window: [
      { ...plain, openings: [made] },
      { kind: "opening", index: 0 },
    ],
    chimney: [
      { ...plain, chimneys: [chimney(face)] },
      { kind: "chimney", index: 0 },
    ],
  };

  const [scene, target] = scenes[aimed];
  const canvas = await page.getByLabel("3D-Szene des Hauses").boundingBox();
  const handle = handles(scene, target, roofs).find(({ grip }) => grip === GRIP[aimed]);

  if (canvas === null || handle === undefined) throw new Error("no canvas or no handle");

  const view = presetView("isometric", pv.geometry(scene));
  const camera = new PerspectiveCamera(40, canvas.width / canvas.height, 0.1, 5000);

  camera.position.set(...view.position);
  camera.lookAt(...view.target);
  camera.updateMatrixWorld();

  const onPage = ([x, y, z]: Triple): Pixel => {
    const at = new Vector3(x, y, z).project(camera);

    return [
      canvas.x + ((at.x + 1) / 2) * canvas.width,
      canvas.y + ((1 - at.y) / 2) * canvas.height,
    ];
  };

  return [onPage(handle.at), onPage(reached(handle))];
}

/** Two metres along an arrow; two metres east for a handle that moves its object. */
function reached({ at: [x, y, z], axis = [1, 0, 0] }: Handle): Triple {
  return [x + axis[0] * 2, y, z + axis[2] * 2];
}

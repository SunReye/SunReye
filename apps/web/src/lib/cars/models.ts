// Uploaded car bodies as three.js objects (ADR 20), read from the core once per id.
import type { Object3D } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { Core, Problem } from "../api/core.ts";
import type { ModelLoader } from "./garage.ts";

/** The model in `bytes`; none for a refusal or a file that does not parse. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the loader takes a plain ArrayBuffer.
async function parse(bytes: ArrayBuffer | Problem): Promise<Object3D | null> {
  if (!(bytes instanceof ArrayBuffer)) return null;

  // The core admitted it with every buffer and image embedded: nothing is fetched.
  const gltf = await new GLTFLoader().parseAsync(bytes, "").catch(() => null);

  return gltf?.scene ?? null;
}

export function modelLoader(core: Pick<Core, "carBody">): ModelLoader {
  const loaded = new Map<string, Promise<Object3D | null>>();

  return (id) => {
    const known = loaded.get(id);

    if (known !== undefined) return known;

    const parsing = core.carBody(id).then(parse);

    loaded.set(id, parsing);

    return parsing;
  };
}

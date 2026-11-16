// Hoch's sky reflections and deeper relief (ADR 20 Look, Rendering quality): glass and module
// covers mirror the sky model, and every finish's normal map stands out further. Set on the
// materials a build already has: none of it makes a new program.
import { Mesh, MeshPhysicalMaterial, MeshStandardMaterial, type Object3D } from "three";

/** A module cover's specular strength: ADR 20's anti-reflective 0.12, and with the sky in it. */
const COVER = { plain: 0.12, rich: 0.4 } as const;

/** How strongly an opening's panes take the sky. */
const PANES = { plain: 1, rich: 1.6 } as const;

/** How much further a normal map stands out in relief. */
const RELIEF = 1.5;

/** A material's normal scale as it was built. */
const built = new WeakMap<MeshStandardMaterial, number>();

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's material, set in place.
function raise(material: MeshStandardMaterial, rich: boolean): void {
  const flat = built.get(material) ?? material.normalScale.x;

  built.set(material, flat);
  material.normalScale.setScalar(rich ? flat * RELIEF : flat);
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's part, set in place.
function gloss(mesh: Object3D, rich: boolean): void {
  const material: unknown = mesh instanceof Mesh ? mesh.material : null;

  if (!(material instanceof MeshStandardMaterial)) return;

  if (material.normalMap !== null) raise(material, rich);

  if (mesh.name === "opening") material.envMapIntensity = rich ? PANES.rich : PANES.plain;

  if (material instanceof MeshPhysicalMaterial && mesh.name === "module") {
    material.specularIntensity = rich ? COVER.rich : COVER.plain;
  }
}

/** Draws `root`'s finishes with Hoch's reflections and relief, or as they were built. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's scene, set in place.
export function enrich(root: Object3D, rich: boolean): void {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's part.
  root.traverse((part) => {
    gloss(part, rich);
  });
}

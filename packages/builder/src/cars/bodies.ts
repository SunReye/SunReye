// Car bodies as three.js objects (ADR 20): the default body, "2024 Tesla Model 3 + Interior" by
// tonielpro520 (CC BY 4.0) cut by scripts/car.ts, painted per place; or an upload fitted to it.
import {
  Box3,
  BufferGeometry,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Vector3,
  type Object3D,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { toThree } from "../builder/scene.ts";
import type { Parked } from "./parked.ts";

// Stealth Grey's finish; each car's paint is a copy in its place's colour.
const PAINT = new MeshPhysicalMaterial({
  roughness: 0.4,
  metalness: 0.1,
  specularIntensity: 0.6,
  clearcoat: 1,
  clearcoatRoughness: 0.04,
});

const GLASS = new MeshPhysicalMaterial({
  color: "#07090b",
  roughness: 0.04,
  metalness: 0.2,
  clearcoat: 1,
});

const TYRE = new MeshStandardMaterial({ color: "#151617", roughness: 0.9 });

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js dresses the mesh in place.
function dress(mesh: Object3D): void {
  if (!(mesh instanceof Mesh)) return;

  const geometry: unknown = mesh.geometry;
  const material: unknown = mesh.material;

  mesh.castShadow = mesh.receiveShadow = true;

  // The file ships positions only.
  if (geometry instanceof BufferGeometry) geometry.computeVertexNormals();

  if (!(material instanceof MeshStandardMaterial)) return;

  if (material.name === "ext_carpaint") mesh.material = PAINT;
  else if (material.name === "EXT_Window" || material.name === "Black_Glass") mesh.material = GLASS;
  else if (material.name === "Tyre") mesh.material = TYRE;
  else {
    // Untextured trim must not turn into mirror chrome.
    material.metalness = Math.min(material.metalness, 0.5);
    material.roughness = Math.max(material.roughness, 0.35);
  }
}

/** The default body at `url`, its nose along +z like any glTF, unpainted. */
export async function loadCar(url: string): Promise<Group> {
  const response = await fetch(url);

  const gltf = await new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(await response.arrayBuffer(), "");

  for (const mesh of gltf.scene.getObjectsByProperty("isMesh", true)) dress(mesh);

  return gltf.scene;
}

/** Turns `object`, whose nose points along its −z, to its stand. */
function stand<T extends Object3D>(object: T, { at, forward: [east, north] }: Parked): T {
  object.position.set(...toThree(at));
  object.rotation.y = Math.atan2(-east, north);
  object.name = "car";

  return object;
}

/** `model` centred over the origin and set on the ground, its front turned from glTF's +z to −z. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js adds the model to a group.
function seat(model: Object3D, scale = 1): Group {
  const inner = new Group();
  const seated = new Group();

  inner.add(model);
  inner.rotation.y = Math.PI;
  inner.scale.setScalar(scale);
  inner.updateMatrixWorld(true);

  const bounds = new Box3().setFromObject(inner);
  const centre = bounds.getCenter(new Vector3());

  inner.position.set(-centre.x, -bounds.min.y, -centre.z);
  seated.add(inner);

  return seated;
}

/** The default body, at its own size, in the car's colour, at its stand. Paint is the car's own. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js clones the template.
export function carBody(car: Parked, template: Group): Group {
  const paint = PAINT.clone();
  const body = template.clone();

  paint.color.set(car.colour);
  paint.userData["paint"] = true;

  for (const mesh of body.getObjectsByProperty("material", PAINT)) {
    if (mesh instanceof Mesh) mesh.material = paint;
  }

  return stand(seat(body), car);
}

/** An uploaded model at its stand, fitted to the place's length. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js adds the model to a group.
export function placedModel(model: Object3D, car: Parked): Group {
  return stand(fitModel(model, car.length), car);
}

/** `model` scaled so its longer horizontal side is `length`, seated on the ground. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js adds the model to a group.
export function fitModel(model: Object3D, length: number): Group {
  const size = new Box3().setFromObject(model).getSize(new Vector3());

  return seat(model, length / Math.max(size.x, size.z, Number.EPSILON));
}

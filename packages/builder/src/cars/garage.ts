// Keeps the scene's cars in step with the live values (ADR 20): drawn again only when a car comes,
// goes or changes body, never for a new charge power or SOC.
import { Group, Material, Mesh, type Object3D } from "three";
import { carBody, loadCar, placedModel } from "./bodies.ts";
import carUrl from "./car.glb?url";
import type { Parked } from "./parked.ts";

export type { Parked } from "./parked.ts";

/** An uploaded body by id, shared between draws; null when it cannot be read. */
export type ModelLoader = (id: string) => Promise<Object3D | null>;

export interface Garage {
  park(cars: readonly Parked[]): void;
  dispose(): void;
}

/** What decides a car's drawing. */
function drawing({ at, forward, length, width, colour, model }: Parked): string {
  return JSON.stringify([at, forward, length, width, colour, model]);
}

/** What decides the cars' drawing: a live tick's power and SOC leave it as it was. */
export function parkedKey(cars: readonly Parked[]): string {
  return JSON.stringify(cars.map((car) => drawing(car)));
}

/** Frees each car's own paint; the default body's meshes and an upload's stay with their loader. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js frees in place.
function release(object: Object3D): void {
  for (const mesh of object.getObjectsByProperty("isMesh", true)) {
    if (
      mesh instanceof Mesh &&
      mesh.material instanceof Material &&
      mesh.material.userData["paint"] === true
    ) {
      mesh.material.dispose();
    }
  }
}

/** Swaps the default body for the uploaded model once it loads, if its cars are still drawn. */
async function upload(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js swaps in place.
  body: Group,
  car: Parked,
  load: ModelLoader,
  render: () => void,
): Promise<void> {
  const loaded = car.model === null ? null : await load(car.model);
  const group = body.parent;

  if (loaded === null || group === null || group.parent === null) return;

  group.remove(body);
  release(body);
  group.add(placedModel(loaded.clone(), car));
  render();
}

/** `template` is the default body (bodies.ts `loadCar`), `model` reads an upload. */
export function garage(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js adds to the scene.
  scene: Object3D,
  render: () => void,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js clones it per car.
  template: Group,
  model?: ModelLoader,
): Garage {
  let drawn = new Group();
  let key = "[]";

  scene.add(drawn);

  return {
    park(cars) {
      const next = parkedKey(cars);

      if (next === key) return;

      key = next;
      scene.remove(drawn);
      release(drawn);
      drawn = new Group();

      for (const car of cars) {
        const body = carBody(car, template);

        drawn.add(body);

        if (model !== undefined) void upload(body, car, model, render);
      }

      scene.add(drawn);
      render();
    },
    dispose() {
      release(drawn);
    },
  };
}

/** A garage once the shipped default body has loaded. */
export async function openGarage(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js adds to the scene.
  scene: Object3D,
  render: () => void,
  model?: ModelLoader,
): Promise<Garage> {
  return garage(scene, render, await loadCar(carUrl), model);
}

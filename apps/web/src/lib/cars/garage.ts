// Keeps the scene's cars in step with the live values (ADR 20): drawn again only when a car comes,
// goes or changes body, never for a new charge power or SOC.
import { BufferGeometry, Group, Material, Mesh, type Object3D } from "three";
import { carBody, placedModel } from "./bodies.ts";
import type { Parked } from "./parked.ts";

/** An uploaded body by id, shared between draws; null when it cannot be read. */
export type ModelLoader = (id: string) => Promise<Object3D | null>;

export interface Garage {
  park(cars: readonly Parked[]): void;
  dispose(): void;
}

/** What decides a car's drawing. */
function drawing({ at, forward, length, width, body, model }: Parked): string {
  return JSON.stringify([at, forward, length, width, body, model]);
}

/** Frees the stylised bodies; an uploaded model's meshes stay with its loader. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js frees in place.
function release(object: Object3D): void {
  if (object.userData["shared"] === true) return;

  if (object instanceof Mesh) {
    if (object.geometry instanceof BufferGeometry) object.geometry.dispose();

    if (object.material instanceof Material) object.material.dispose();
  }

  for (const child of object.children) release(child);
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js adds to the scene.
export function garage(scene: Object3D, render: () => void, model?: ModelLoader): Garage {
  let drawn = new Group();
  let key = "[]";

  scene.add(drawn);

  /** Swaps the stylised body for the uploaded model once it loads, if still parked. */
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js swaps in place.
  async function upload(body: Group, car: Parked, id: string, load: ModelLoader): Promise<void> {
    const loaded = await load(id);
    const group = body.parent;

    if (loaded === null || group === null || group !== drawn) return;

    const placed = placedModel(loaded.clone(), car);

    placed.userData["shared"] = true;
    group.remove(body);
    release(body);
    group.add(placed);
    render();
  }

  return {
    park(cars) {
      const next = JSON.stringify(cars.map((car) => drawing(car)));

      if (next === key) return;

      key = next;
      scene.remove(drawn);
      release(drawn);
      drawn = new Group();

      for (const car of cars) {
        const body = carBody(car);

        drawn.add(body);

        if (car.model !== null && model !== undefined) void upload(body, car, car.model, model);
      }

      scene.add(drawn);
      render();
    },
    dispose() {
      release(drawn);
    },
  };
}

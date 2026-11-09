/// <reference types="bun" />
import { expect, test } from "bun:test";
import { BoxGeometry, Group, Mesh, type Object3D } from "three";
import { garage } from "./garage.ts";
import type { Parked } from "./parked.ts";

const car: Parked = {
  device: 7,
  at: [4, -3, 0],
  forward: [0, 1, 0],
  above: [4, -3, 2.5],
  length: 5,
  width: 2.5,
  body: { class: "sedan", colour: "#f2f2ee" },
  model: null,
  watts: 7360,
  soc: 63,
};

function counting() {
  let count = 0;

  return {
    scene: new Group(),
    renders: () => count,
    render: () => {
      count += 1;
    },
  };
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js searches a live group.
const cars = (scene: Group): Object3D[] => scene.getObjectsByProperty("name", "car");

test("a car is drawn once; a live tick that changes only its power or SOC draws nothing", () => {
  const { scene, renders, render } = counting();
  const parking = garage(scene, render);

  parking.park([car]);
  parking.park([{ ...car, watts: 0, soc: 64 }]);

  expect(cars(scene)).toHaveLength(1);
  expect(renders()).toBe(1);
});

test("a car that leaves empties its place and draws once", () => {
  const { scene, renders, render } = counting();
  const parking = garage(scene, render);

  parking.park([car]);
  parking.park([]);

  expect(cars(scene)).toHaveLength(0);
  expect(renders()).toBe(2);
});

test("an uploaded model replaces the stylised body once it loads", async () => {
  const { scene, render } = counting();
  const model = new Mesh(new BoxGeometry(4, 1.5, 2));
  const loaded = Promise.resolve<Object3D | null>(model);
  const parking = garage(scene, render, () => loaded);

  parking.park([{ ...car, model: "ab".repeat(32) }]);
  await loaded;
  await Promise.resolve();

  const [drawn] = cars(scene);

  expect(cars(scene)).toHaveLength(1);
  // The model's one mesh, without the stylised body's.
  expect(drawn?.getObjectsByProperty("isMesh", true)).toHaveLength(1);
});

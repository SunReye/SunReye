/// <reference types="bun" />
import { expect, test } from "bun:test";
import {
  Color,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type Object3D,
  PlaneGeometry,
  Texture,
} from "three";
import type { Geometry } from "@sunreye/builder/builder/pv.ts";
import { buildScene } from "@sunreye/builder/builder/scene.ts";
import { luma } from "./light.harness.ts";
import { Plot } from "@sunreye/builder/scene/plot.ts";
import { DRY } from "@sunreye/builder/scene/weather.ts";
import { weathered } from "@sunreye/builder/scene/weathered.ts";

const CORNERS = [
  [0, 0, 3],
  [10, 0, 3],
  [10, -8, 5],
  [0, -8, 5],
] as const;

const house: Geometry = {
  faces: [
    { surface: "roof", corners: CORNERS, colour: "#aa3322" },
    {
      surface: "wall",
      corners: [
        [0, 0, 0],
        [10, 0, 0],
        [10, 0, 3],
        [0, 0, 3],
      ],
    },
  ],
  solids: [],
  ground: [
    {
      finish: "lawn",
      corners: CORNERS.map(([e, n]) => [e + 20, n, 0] as const),
    },
  ],
};

const built = (): Group =>
  buildScene(house, [{ corners: CORNERS.map(([e, n, u]) => [e / 10, n / 10, u] as const) }]);

/** The last part named `name`, as its material: a roof in its block's colour comes after the
 * finish's own. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
function finish(part: Object3D, name: string): MeshStandardMaterial {
  const found = part.getObjectsByProperty("name", name).at(-1);
  const material: unknown = found instanceof Mesh ? found.material : undefined;

  if (material instanceof MeshStandardMaterial) return material;

  throw new TypeError(`no ${name}`);
}

/** The drawn module's material. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
function glass(group: Group): MeshPhysicalMaterial {
  const module = group.getObjectByName("module");

  if (module instanceof Mesh && module.material instanceof MeshPhysicalMaterial)
    return module.material;

  throw new TypeError("no module");
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
const light = (material: MeshStandardMaterial): number => luma(material.color);

test("wet roofs and ground darken and take a sheen; walls stay as they are", () => {
  const group = built();

  const lights = () => ({
    roof: light(finish(group, "roof")),
    ground: light(finish(group, "ground")),
    wall: light(finish(group, "wall")),
  });

  const dry = lights();

  weathered(group, { ...DRY, wet: 1 });

  const wet = lights();

  expect(wet.roof).toBeLessThan(0.8 * dry.roof);
  expect(wet.ground).toBeLessThan(0.8 * dry.ground);
  expect(wet.wall).toBe(dry.wall);
  expect(finish(group, "roof").roughness).toBeLessThan(0.7);
  // Still the block's own colour: red leads.
  expect(finish(group, "roof").color.r).toBeGreaterThan(2 * finish(group, "roof").color.g);

  weathered(group, { ...DRY, wet: 0.5 });

  expect(light(finish(group, "roof"))).toBeGreaterThan(wet.roof);
  expect(light(finish(group, "roof"))).toBeLessThan(dry.roof);
});

test("the weather is applied from the dry finish each time: it never adds up, and dry is as built", () => {
  const group = built();
  const roof = finish(group, "roof");
  const dry = { hex: roof.color.getHex(), roughness: roof.roughness };

  weathered(group, { ...DRY, wet: 1 });

  const once = roof.color.getHex();

  weathered(group, { ...DRY, wet: 1 });
  expect(roof.color.getHex()).toBe(once);
  weathered(group, { ...DRY, snow: true });
  weathered(group, DRY);
  expect({ hex: roof.color.getHex(), roughness: roof.roughness }).toEqual(dry);
});

test("lying snow whitens roofs and ground, whatever their colour, and leaves the modules black", () => {
  const group = built();

  weathered(group, { ...DRY, snow: true, wet: 1 });

  for (const name of ["roof", "ground"]) {
    const { color, roughness } = finish(group, name);

    expect(luma(color)).toBeGreaterThan(0.85);
    expect(Math.max(color.r, color.g, color.b) / Math.min(color.r, color.g, color.b)).toBeLessThan(
      1.1,
    );
    expect(roughness).toBeGreaterThan(0.9);
  }

  expect(glass(group).map).not.toBeNull();
});

test("snow-covered modules draw white and matte; uncovered, they are the black glass again", () => {
  const group = built();
  const material = glass(group);

  const dry = {
    map: material.map,
    rough: material.roughnessMap,
    env: material.envMapIntensity,
  };

  weathered(group, { ...DRY, snow: true, covered: true });
  expect([material.map, material.roughnessMap, material.envMapIntensity]).toEqual([null, null, 0]);
  expect(luma(material.color)).toBeGreaterThan(0.85);
  expect(material.roughness).toBeGreaterThan(0.9);

  weathered(group, { ...DRY, snow: true });
  expect([material.map, material.roughnessMap, material.envMapIntensity]).toEqual([
    dry.map,
    dry.rough,
    dry.env,
  ]);
  expect(material.color.equals(new Color(0xffffff))).toBe(true);
});

test("the studio floor takes the weather as the ground does", () => {
  const { floor } = new Plot();
  const material = finish(floor, "floor");
  const dry = light(material);

  weathered(floor, { ...DRY, wet: 1 });
  expect(light(material)).toBeLessThan(0.8 * dry);
  weathered(floor, { ...DRY, snow: true });
  expect(light(material)).toBeGreaterThan(0.85);
});

test("lying snow covers the aerial image on the ground and the roofs; once gone, the image is back", () => {
  const image = new Texture();
  const group = new Group();

  for (const name of ["aerial", "roof", "flat"]) {
    const part = new Mesh(new PlaneGeometry(), new MeshStandardMaterial({ map: image }));

    part.name = name;
    group.add(part);
  }

  weathered(group, { ...DRY, snow: true });

  for (const name of ["aerial", "roof", "flat"]) {
    expect(finish(group, name).map).toBeNull();
    expect(light(finish(group, name))).toBeGreaterThan(0.9);
  }

  weathered(group, { ...DRY, wet: 0.5 });

  for (const name of ["aerial", "roof", "flat"]) expect(finish(group, name).map).toBe(image);
});

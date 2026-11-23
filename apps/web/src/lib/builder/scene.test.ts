/// <reference types="bun" />
import { expect, spyOn, test } from "bun:test";
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  InstancedMesh,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type Object3D,
} from "three";
import type { Geometry } from "@sunreye/builder/builder/pv.ts";
import { buildScene, buildSliced, stringColour } from "@sunreye/builder/builder/scene.ts";

const house: Geometry = {
  faces: [
    {
      surface: "roof",
      corners: [
        [0, 0, 3],
        [10, 0, 3],
        [10, -8, 5],
        [0, -8, 5],
      ],
    },
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
  solids: [
    { kind: "sphere", centre: [-4, 0, 8], radius: 2 },
    { kind: "cylinder", base: [3, -2, 0], radius: 0.3, height: 9 },
  ],
};

const corners = [
  [0, -1, 3],
  [1, -1, 3],
  [1, -2, 3],
  [0, -2, 3],
] as const;

function part(name: string): Object3D {
  const found = buildScene(house).getObjectByName(name);

  if (found === undefined) throw new Error(`no ${name}`);

  return found;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
function standard(found: Object3D | undefined): MeshStandardMaterial {
  if (!(found instanceof Mesh) || !(found.material instanceof MeshStandardMaterial)) {
    throw new TypeError("no material");
  }

  return found.material;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
function glass(mesh: Object3D | undefined): MeshPhysicalMaterial {
  if (!(mesh instanceof Mesh) || !(mesh.material instanceof MeshPhysicalMaterial)) {
    throw new TypeError("no module glass");
  }

  return mesh.material;
}

function material(name: string): MeshStandardMaterial {
  return standard(part(name));
}

function vertices(name: string): number[][] {
  const found = part(name);

  if (!(found instanceof Mesh) || !(found.geometry instanceof BufferGeometry)) {
    throw new TypeError(`${name} has no geometry`);
  }

  const position: unknown = found.geometry.getAttribute("position");

  if (!(position instanceof BufferAttribute)) throw new TypeError(`${name} has no positions`);

  return Array.from({ length: position.count }, (_, i) => [
    position.getX(i),
    position.getY(i),
    position.getZ(i),
  ]);
}

test("a roof is drawn as triangles with up as y and north as −z", () => {
  const roof = vertices("roof");

  expect(roof).toHaveLength(6);
  expect(roof).toContainEqual([10, 5, 8]);
  expect(roof).toContainEqual([0, 3, 0]);
});

test("walls and roofs are drawn apart, each in its own tone", () => {
  expect(vertices("wall")).toContainEqual([10, 3, 0]);
  expect(material("wall").color.getHex()).not.toBe(material("roof").color.getHex());
});

test("a flat roof is drawn apart from a pitched one, in the same roof tone", () => {
  const flat: Geometry = {
    faces: [
      {
        surface: "roof",
        corners: [
          [0, 0, 3],
          [10, 0, 3],
          [10, -8, 3],
        ],
      },
    ],
    solids: [],
  };

  const drawn = buildScene(flat).getObjectByName("flat");
  const triangles: unknown = drawn instanceof Mesh ? drawn.geometry : null;

  const position: unknown =
    triangles instanceof BufferGeometry ? triangles.getAttribute("position") : null;

  expect(standard(drawn).color.getHex()).toBe(material("roof").color.getHex());
  expect(position instanceof BufferAttribute ? position.count : 0).toBe(3);
});

test("only a module carries maps, generated in code: all else is plain clay", () => {
  const maps = ["map", "normalMap", "roughnessMap", "emissiveMap"] as const;
  const mapped = new Map<string, unknown[]>();

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
  buildScene(house, [{ corners, string: 0 }]).traverse((object) => {
    if (object instanceof Mesh && object.material instanceof MeshStandardMaterial) {
      const used = object.material;
      const found = maps.flatMap((key) => (used[key] === null ? [] : [used[key]]));

      if (found.length > 0) mapped.set(object.name, found);
    }
  });

  expect([...mapped.keys()]).toEqual(["module"]);
  expect(mapped.get("module")?.every((map) => map instanceof DataTexture)).toBe(true);
});

test("a crown is drawn at its centre; a pole stands on its base, its radius short of its height", () => {
  const [crown, pole] = buildScene(house).getObjectsByProperty("name", "solid");
  const bounds = new Box3().setFromObject(pole ?? new Mesh());

  expect(crown?.position.toArray()).toEqual([-4, 8, 0]);
  expect(bounds.min.y).toBeCloseTo(0, 5);
  expect(bounds.max.y).toBeCloseTo(8.7, 5);
  expect([pole?.position.x, pole?.position.z]).toEqual([3, 2]);
});

test("a crown is one soft ball and the trunk beneath it a tone of its own; a lone pole is clay", () => {
  const tree: Geometry = {
    faces: [],
    solids: [
      { kind: "cylinder", base: [0, 0, 0], radius: 0.3, height: 4 },
      { kind: "sphere", centre: [0, 0, 5], radius: 2 },
      { kind: "cylinder", base: [6, 0, 0], radius: 0.1, height: 6 },
    ],
  };

  const [trunk, crown, pole] = buildScene(tree).getObjectsByProperty("name", "solid");

  const bounds = new Box3().setFromObject(crown ?? new Mesh());

  expect(crown).not.toBeInstanceOf(InstancedMesh);
  expect(bounds.max.y - bounds.min.y).toBeCloseTo(4, 1);
  expect(standard(trunk).color.getHex()).not.toBe(standard(pole).color.getHex());
  expect(standard(crown).color.getHex()).not.toBe(standard(trunk).color.getHex());
});

test("modules are full black under glass that mirrors the sky more than the lights", () => {
  const painted = buildScene(house, [{ corners, string: 0 }, { corners }]).getObjectByName(
    "module",
  );

  // Plain glass reflects at a specular intensity of 1: the sun and the moon leave no glare.
  expect(glass(painted).specularIntensity).toBeLessThanOrEqual(0.25);
  expect(glass(painted).envMapIntensity).toBeGreaterThan(1);
  expect(glass(painted).color.getHex()).toBe(0xffffff);
  expect(stringColour(null)).not.toBe(stringColour(0));
});

test("each equipment marker is drawn where the crate hung it, turned to face out of its wall", () => {
  // On a house turned to face west: out of its front wall is west.
  const mounts = [{ at: [-8.1, -2, 1.5], above: [-8.1, -2, 8], out: [-1, 0, 0] }] as const;
  const [marker] = buildScene({ ...house, mounts }).getObjectsByProperty("name", "equipment");

  expect(marker?.position.toArray()).toEqual([-8.1, 1.5, 2]);
  expect(marker?.rotation.y).toBeCloseTo(-Math.PI / 2, 9);
});

/** Each part's name, in order. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's group.
const names = (group: Object3D): string[] => group.children.map((child) => child.name);

test("built in slices, the scene waits at each yield between sections and ends as the whole build", async () => {
  const yields: (() => void)[] = [];
  let done = false;

  const building = buildSliced(house, [], async () => {
    const { promise, resolve } = Promise.withResolvers<void>();

    yields.push(resolve);
    await promise;
  });

  void (async () => {
    await building;
    done = true;
  })();

  /** Lets go of each yield in turn; the build ends only after the last. */
  async function release(seen: number): Promise<number> {
    await Bun.sleep(0);

    if (done) return seen;

    expect(yields).toHaveLength(seen + 1);
    yields.at(-1)?.();

    return release(seen + 1);
  }

  expect(await release(0)).toBeGreaterThan(2);

  expect(names(await building)).toEqual(names(buildScene(house)));
});

test("a section with nothing to draw adds nothing and logs nothing", async () => {
  const logged = spyOn(console, "error").mockImplementation(() => {});

  try {
    // The house has no hedge, ground, fence, module or marker.
    buildScene(house);
    await buildSliced(house, [], async () => {});

    expect(logged).not.toHaveBeenCalled();
  } finally {
    logged.mockRestore();
  }
});

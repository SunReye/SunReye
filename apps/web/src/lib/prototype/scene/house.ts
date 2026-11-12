// PROTOTYPE: the plant as an architectural visualisation. Pure builders; Scene3d owns rendering.
// House 14 x 10 m, eaves at 6 m, 30° gable roof (ADR 20's clay model, now with real materials).
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import * as tex from "./textures";
import { buildCar, CHARGE_PORT } from "./car";

export type AnchorId = "s1" | "s2" | "s3" | "inverter" | "battery" | "ev";

export interface Plant {
  root: THREE.Group;
  anchors: Record<AnchorId, THREE.Vector3>;
  /** One material per string; its emissive lights the cells by share of peak. */
  strings: Record<string, THREE.MeshPhysicalMaterial>;
  /** Window panes, warm-lit at night. */
  panes: THREE.MeshPhysicalMaterial;
  /** Ground pieces that fade into the studio backdrop. */
  fade: { uniform: { value: number } };
}

const PITCH = Math.PI / 6;
const RISE = 5 * Math.tan(PITCH);
const OVER = 0.55;

function repeat<T extends THREE.Texture>(t: T, x: number, y: number): T {
  const c = t.clone() as T;
  c.repeat.set(x, y);
  c.needsUpdate = true;
  return c;
}

/** Fades a material's alpha with distance from the plot centre (studio mode), in world space. */
function fadeable(m: THREE.MeshStandardMaterial, uniform: { value: number }): THREE.MeshStandardMaterial {
  m.transparent = true;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uFade = uniform;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vFadeWorld;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvFadeWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vFadeWorld;\nuniform float uFade;")
      .replace(
        "#include <alphatest_fragment>",
        "#include <alphatest_fragment>\ndiffuseColor.a *= mix(1.0, 1.0 - smoothstep(7.0, 17.0, length(vFadeWorld.xz - vec2(1.5, 2.0))), uFade);",
      );
  };
  return m;
}

const shadowed = <T extends THREE.Object3D>(o: T): T => {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  return o;
};

export function buildPlant(ready: () => void = () => {}): Plant {
  const root = new THREE.Group();
  const fade = { uniform: { value: 1 } };

  // Materials.
  const plaster = tex.plaster();
  const wallLong = new THREE.MeshStandardMaterial({ map: repeat(plaster.map, 14 / 3, 6 / 3), normalMap: repeat(plaster.normalMap, 14 / 3, 6 / 3), normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.92 });
  const wallShort = new THREE.MeshStandardMaterial({ map: repeat(plaster.map, 10 / 3, 6 / 3), normalMap: repeat(plaster.normalMap, 10 / 3, 6 / 3), normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.92 });
  const gableMat = new THREE.MeshStandardMaterial({ map: repeat(plaster.map, 1 / 3, 1 / 3), normalMap: repeat(plaster.normalMap, 1 / 3, 1 / 3), normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.92 });
  const pl = tex.plinth();
  const plinthMat = new THREE.MeshStandardMaterial({ map: repeat(pl.map, 6, 0.3), normalMap: repeat(pl.normalMap, 6, 0.3), roughness: 0.85 });
  const tiles = tex.roofTiles();
  const slope = 5 / Math.cos(PITCH);
  const L = slope + OVER;
  const tileMat = new THREE.MeshStandardMaterial({
    map: repeat(tiles.map, 14.8 / 2.4, L / 2.64),
    normalMap: repeat(tiles.normalMap, 14.8 / 2.4, L / 2.64),
    roughnessMap: repeat(tiles.roughnessMap, 14.8 / 2.4, L / 2.64),
    normalScale: new THREE.Vector2(1.2, 1.2),
    roughness: 1,
  });
  const fascia = new THREE.MeshStandardMaterial({ color: "#2c2f34", roughness: 0.55, metalness: 0.1 });
  const soffit = new THREE.MeshStandardMaterial({ color: "#e9e6e0", roughness: 0.8 });
  const metal = new THREE.MeshStandardMaterial({ color: "#7d8288", roughness: 0.35, metalness: 0.85 });
  const frameMat = new THREE.MeshStandardMaterial({ color: "#2e3136", roughness: 0.45, metalness: 0.2 });
  const sillMat = new THREE.MeshStandardMaterial({ color: "#9aa0a6", roughness: 0.3, metalness: 0.8 });
  const panes = new THREE.MeshPhysicalMaterial({
    color: "#1b222b",
    roughness: 0.03,
    metalness: 0,
    ior: 1.52,
    specularIntensity: 1,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    envMapIntensity: 1.6,
    emissive: new THREE.Color("#ffb070"),
    emissiveIntensity: 0,
  });

  // Walls and plinth.
  const walls = new THREE.Mesh(new THREE.BoxGeometry(14, 6, 10), [wallShort, wallShort, wallLong, wallLong, wallLong, wallLong]);
  walls.position.y = 3;
  root.add(shadowed(walls));
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(14.06, 0.42, 10.06), plinthMat);
  plinth.position.y = 0.21;
  root.add(shadowed(plinth));

  // Gables.
  const tri = new THREE.Shape();
  tri.moveTo(-5, 0);
  tri.lineTo(5, 0);
  tri.lineTo(0, RISE);
  tri.closePath();
  const gable = new THREE.Mesh(new THREE.ExtrudeGeometry(tri, { depth: 14, bevelEnabled: false }), gableMat);
  gable.rotation.y = Math.PI / 2;
  gable.position.set(-7, 6, 0);
  root.add(shadowed(gable));

  // Roof faces: local z runs down the slope, local y is the face normal.
  const faces: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const g = new THREE.Group();
    g.rotation.x = s * PITCH;
    const eaveZ = 5 + OVER * Math.cos(PITCH);
    const eaveY = 6 - OVER * Math.sin(PITCH);
    g.position.set(0, (6 + RISE + eaveY) / 2 + 0.11 * Math.cos(PITCH), s * (eaveZ / 2 + 0.11 * Math.sin(PITCH)));
    // Box faces: +x, -x, +y (tiles), -y (soffit), +z, -z.
    const slab = new THREE.Mesh(new THREE.BoxGeometry(14.8, 0.22, L), [fascia, fascia, tileMat, soffit, fascia, fascia]);
    g.add(shadowed(slab));
    root.add(g);
    g.updateMatrixWorld(true);
    faces.push(g);

    // Fascia board, gutter and downpipes along the eave.
    const ez = s * (eaveZ + 0.03);
    const gutter = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 14.9, 16), metal);
    gutter.rotation.z = Math.PI / 2;
    gutter.position.set(0, eaveY - 0.12, ez + s * 0.07);
    gutter.material = metal;
    root.add(shadowed(gutter));
    for (const x of [-7.25, 7.25]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, eaveY - 0.1, 10), metal);
      pipe.position.set(x, (eaveY - 0.1) / 2, ez + s * 0.07);
      root.add(shadowed(pipe));
    }
  }

  // Ridge cap.
  const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 14.85, 16), fascia);
  ridge.rotation.z = Math.PI / 2;
  ridge.position.set(0, 6 + RISE + 0.12, 0);
  root.add(shadowed(ridge));

  // Chimney on the north slope.
  const chimney = new THREE.Group();
  const stack = new THREE.Mesh(new THREE.BoxGeometry(0.75, 2.6, 0.75), plinthMat);
  stack.position.y = 1.3;
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.1, 0.95), fascia);
  cap.position.y = 2.65;
  chimney.add(stack, cap);
  chimney.position.set(-3.6, 6 + RISE - 1.2 * Math.tan(PITCH) - 1.1, -1.2);
  root.add(shadowed(chimney));

  // Windows: anthracite frames, sills, reflective panes.
  const window = (w: number, h: number, x: number, y: number, z: number, ry: number, bars = w > 1.3) => {
    const g = new THREE.Group();
    const t = 0.07, d = 0.1;
    const parts: [number, number, number, number][] = [
      [w, t, 0, h / 2 - t / 2],
      [w, t, 0, -h / 2 + t / 2],
      [t, h, -w / 2 + t / 2, 0],
      [t, h, w / 2 - t / 2, 0],
    ];
    if (bars) parts.push([t * 0.8, h, 0, 0]);
    for (const [pw, ph, px, py] of parts) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, d), frameMat);
      m.position.set(px, py, 0.02);
      g.add(m);
    }
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w - t, h - t), panes);
    glass.position.z = 0.0;
    g.add(glass);
    // Dark reveal so the opening reads as depth.
    const reveal = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.16, h + 0.16), new THREE.MeshStandardMaterial({ color: "#8f8a82", roughness: 0.9 }));
    reveal.position.z = -0.005;
    g.add(reveal);
    const sill = new THREE.Mesh(new THREE.BoxGeometry(w + 0.14, 0.035, 0.2), sillMat);
    sill.position.set(0, -h / 2 - 0.03, 0.09);
    g.add(sill);
    g.position.set(x, y, z);
    g.rotation.y = ry;
    root.add(shadowed(g));
  };
  const S = 5.012, N = -5.012, E = 7.012, W = -7.012;
  for (const x of [-4.6, -1.6, 1.6, 4.6]) window(1.25, 1.35, x, 4.35, S, 0);
  window(2.2, 1.6, -4.3, 1.75, S, 0);
  window(2.2, 1.6, 4.3, 1.75, S, 0);
  window(0.6, 1.6, 1.55, 1.75, S, 0, false);
  for (const x of [-4.6, 0, 4.6]) window(1.25, 1.35, x, 4.35, N, Math.PI);
  for (const x of [-3.5, 3.5]) window(1.25, 1.35, x, 1.7, N, Math.PI);
  // Side walls: (x, z) swapped, the window faces ±x.
  window(1.25, 1.35, E, 4.35, -2.4, Math.PI / 2);
  window(1.25, 1.35, E, 4.35, 2.4, Math.PI / 2);
  window(1.25, 1.35, W, 4.35, 0, -Math.PI / 2);
  window(1.25, 1.35, W, 1.7, 2.5, -Math.PI / 2);
  window(0.9, 1.0, E, 7.0, 0, Math.PI / 2, false);
  window(0.9, 1.0, W, 7.0, 0, -Math.PI / 2, false);

  // Front door with a glass canopy and a step.
  const w = tex.wood();
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.25, 0.08), new THREE.MeshStandardMaterial({ map: w.map, normalMap: w.normalMap, roughness: 0.55 }));
  door.position.set(0.25, 0.42 + 1.125, 5.03);
  root.add(shadowed(door));
  for (const [pw, ph, px, py] of [[1.3, 0.08, 0.25, 2.71], [0.08, 2.3, -0.36, 1.56], [0.08, 2.3, 0.86, 1.56]] as const) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, 0.12), frameMat);
    f.position.set(px, py, 5.04);
    root.add(shadowed(f));
  }
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.9, 0.05), metal);
  handle.position.set(0.68, 1.55, 5.1);
  root.add(handle);
  const canopy = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 0.04, 1.0),
    new THREE.MeshPhysicalMaterial({ color: "#c8d2da", roughness: 0.05, transmission: 0, transparent: true, opacity: 0.45, metalness: 0.1 }),
  );
  canopy.position.set(0.25, 3.0, 5.5);
  canopy.castShadow = true;
  root.add(canopy);
  const step = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.18, 0.9), plinthMat);
  step.position.set(0.25, 0.09, 5.45);
  root.add(shadowed(step));

  // Equipment on the east wall: inverter, battery, wallbox.
  const box = (w: number, h: number, d: number, label: THREE.Texture | null, led: string, pos: THREE.Vector3) => {
    const body = new THREE.MeshStandardMaterial({ color: "#eceef0", roughness: 0.4, metalness: 0.05 });
    const front = label ? new THREE.MeshStandardMaterial({ map: label, roughness: 0.4 }) : body;
    const m = new THREE.Mesh(new RoundedBoxGeometry(d, h, w, 3, 0.03), [front, body, body, body, body, body]);
    m.position.copy(pos);
    root.add(shadowed(m));
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.12), new THREE.MeshStandardMaterial({ color: led, emissive: led, emissiveIntensity: 3 }));
    l.position.set(pos.x + d / 2 + 0.005, pos.y + h * 0.3, pos.z);
    root.add(l);
    return m;
  };
  box(0.55, 0.75, 0.2, tex.label("inv", "SunReye", "Hybrid 10K", "#f2a33a"), "#47d18c", new THREE.Vector3(7.11, 1.75, 1.6));
  box(0.7, 1.15, 0.28, tex.label("bat", "SunReye", "Battery 15.4", "#47d18c"), "#47d18c", new THREE.Vector3(7.15, 0.58 + 0.42, 3.2));
  box(0.3, 0.42, 0.14, null, "#9b6cf0", new THREE.Vector3(7.08, 1.35, 4.4));

  // PV modules: full black, black anodised frames, AR glass over black cells.
  const pv = tex.pvModule();
  const frameGeo = new THREE.BoxGeometry(1.06, 0.04, 1.74);
  const glassGeo = new THREE.PlaneGeometry(1.02, 1.7);
  glassGeo.rotateX(-Math.PI / 2);
  const alu = new THREE.MeshStandardMaterial({ color: "#0e0f11", roughness: 0.4, metalness: 0.6 });
  const strings: Plant["strings"] = {};
  const anchors = {} as Record<AnchorId, THREE.Vector3>;
  const addString = (face: THREE.Group, id: AnchorId, x0: number, cols: number, rows: number) => {
    const mat = new THREE.MeshPhysicalMaterial({
      map: pv.map,
      roughnessMap: pv.roughnessMap,
      roughness: 0.5,
      metalness: 0,
      // AR-coated glass reflects about half of plain glass; keeps the cells black under a blue sky.
      specularIntensity: 0.35,
      clearcoat: 0.25,
      clearcoatRoughness: 0.08,
      emissive: new THREE.Color("#ffa63a"),
      emissiveMap: pv.glow,
    });
    strings[id] = mat;
    const group = new THREE.Group();
    const z0 = -((rows - 1) * 1.77) / 2 - 0.15;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const x = x0 + c * 1.09, z = z0 + r * 1.77;
        const frame = new THREE.Mesh(frameGeo, alu);
        frame.position.set(x, 0.2, z);
        const glass = new THREE.Mesh(glassGeo, mat);
        glass.position.set(x, 0.222, z);
        frame.castShadow = glass.castShadow = true;
        frame.receiveShadow = glass.receiveShadow = true;
        group.add(frame, glass);
      }
    face.add(group);
    anchors[id] = face.localToWorld(new THREE.Vector3(x0 + ((cols - 1) * 1.09) / 2, 0.3, z0 + ((rows - 1) * 1.77) / 2));
  };
  addString(faces[0]!, "s1", -6.25, 5, 2);
  addString(faces[0]!, "s3", 0.85, 5, 2);
  addString(faces[1]!, "s2", -2.15, 4, 2);
  anchors.inverter = new THREE.Vector3(7.25, 1.75, 1.6);
  anchors.battery = new THREE.Vector3(7.3, 1.1, 3.2);
  anchors.ev = new THREE.Vector3(11.2, 1.55, 3.6);

  // Ground: lawn to the horizon, pavers, a street; everything fades out in studio mode.
  const g = tex.grass();
  const lawn = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000),
    fadeable(new THREE.MeshStandardMaterial({ map: repeat(g.map, 1300, 1300), normalMap: repeat(g.normalMap, 1300, 1300), roughness: 0.95 }), fade.uniform),
  );
  lawn.rotation.x = -Math.PI / 2;
  lawn.receiveShadow = true;
  root.add(lawn);
  const pv2 = tex.pavers();
  const paving = (w: number, d: number, x: number, z: number) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      fadeable(new THREE.MeshStandardMaterial({ map: repeat(pv2.map, w / 1.6, d / 1.6), normalMap: repeat(pv2.normalMap, w / 1.6, d / 1.6), roughness: 0.8 }), fade.uniform),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.012, z);
    m.receiveShadow = true;
    root.add(m);
  };
  paving(1.6, 8.6, 0.25, 9.6); // path from the door to the street
  paving(4.2, 19, 11.2, 4.4); // driveway
  paving(30, 1.6, 4, 14.6); // pavement
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 7),
    fadeable(new THREE.MeshStandardMaterial({ color: "#3b3d40", roughness: 0.9, normalMap: repeat(pl.normalMap, 120, 2) }), fade.uniform),
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.008, 19);
  road.receiveShadow = true;
  root.add(road);

  // Tree: bark trunk, a few limbs, layered instanced foliage clusters.
  const tree = new THREE.Group();
  const b = tex.bark();
  const barkMat = new THREE.MeshStandardMaterial({ map: repeat(b.map, 2, 2), normalMap: repeat(b.normalMap, 2, 2), roughness: 0.95 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.3, 3.6, 14), barkMat);
  trunk.position.y = 1.8;
  tree.add(trunk);
  for (const [rx, rz, y] of [[0.6, 0.2, 2.9], [-0.5, -0.4, 3.2], [0.2, -0.7, 3.4]] as const) {
    const limb = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.11, 1.8, 8), barkMat);
    limb.position.set(rx * 0.8, y + 0.6, rz * 0.8);
    limb.rotation.set(rz, 0, -rx);
    tree.add(limb);
  }
  const leafCluster = (count: number, centre: THREE.Vector3, radii: THREE.Vector3, seed: number) => {
    let s = seed;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const geo = new THREE.IcosahedronGeometry(0.5, 1);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.8, normalMap: repeat(g.normalMap, 1, 1), normalScale: new THREE.Vector2(1.5, 1.5) });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    const col = new THREE.Color();
    for (let i = 0; i < count; i++) {
      // Points in an ellipsoid shell, denser outside so the crown reads as clusters.
      const u = r() * 2 - 1, phi = r() * Math.PI * 2, rad = 0.55 + 0.45 * Math.cbrt(r());
      const sq = Math.sqrt(1 - u * u);
      p.set(centre.x + radii.x * rad * sq * Math.cos(phi), centre.y + radii.y * rad * u, centre.z + radii.z * rad * sq * Math.sin(phi));
      e.set(r() * 3, r() * 3, r() * 3);
      q.setFromEuler(e);
      const k = 0.6 + r() * 0.65;
      sc.set(k, k * (0.8 + r() * 0.3), k);
      m.compose(p, q, sc);
      mesh.setMatrixAt(i, m);
      // Lighter, yellower leaves high and outside; darker inside and below.
      const lift = (p.y - centre.y) / radii.y;
      col.setHSL(0.24 + r() * 0.05, 0.38 + r() * 0.14, 0.17 + lift * 0.05 + r() * 0.07, THREE.SRGBColorSpace);
      mesh.setColorAt(i, col);
    }
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  };
  tree.add(leafCluster(260, new THREE.Vector3(0, 5.2, 0), new THREE.Vector3(2.7, 2.2, 2.7), 7));
  tree.position.set(-11.5, 0, 5.2);
  root.add(shadowed(tree));
  // Shrubs along the west and south-west.
  for (const [x, z, s] of [[-8.3, 3.6, 0.9], [-8.4, -1.0, 0.8], [-5.8, 6.1, 0.7], [5.8, 6.1, 0.65]] as const) {
    const shrub = leafCluster(22, new THREE.Vector3(0, 0.75 * s, 0), new THREE.Vector3(0.9 * s, 0.7 * s, 0.9 * s), Math.round(x * 100 + z));
    shrub.scale.setScalar(0.75);
    shrub.position.set(x, 0, z);
    root.add(shrub);
  }

  // Car on the driveway, nose south, charging from the wallbox at its rear-left port.
  const car = buildCar(ready);
  car.position.set(11.2, 0, 3.6);
  root.add(car);
  const port = CHARGE_PORT.clone().add(car.position);
  const cable = new THREE.Mesh(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(7.16, 1.2, 4.4),
        new THREE.Vector3(7.5, 0.04, 4.0),
        new THREE.Vector3(8.8, 0.03, 2.2),
        new THREE.Vector3(10.4, 0.03, 0.85),
        new THREE.Vector3(11.9, 0.03, 0.8),
        new THREE.Vector3(port.x + 0.25, 0.35, port.z - 0.1),
        port,
      ]),
      64,
      0.022,
      8,
    ),
    new THREE.MeshStandardMaterial({ color: "#151618", roughness: 0.6 }),
  );
  root.add(shadowed(cable));

  return { root, anchors, strings, panes, fade };
}

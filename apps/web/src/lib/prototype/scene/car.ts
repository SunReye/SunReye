// PROTOTYPE: "2024 Tesla Model 3 + Interior" by tonielpro520, CC BY 4.0,
// https://sketchfab.com/3d-models/61ddcbdbd3854c239e0c95bf60b00022 — low-poly cut: no interior,
// badges or textures, ~8.5k triangles, meshopt, 140 KB. An uploaded GLB replaces it.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import carUrl from "./car.glb?url";

// Stealth Grey: quiet next to the energy colours.
const paint = new THREE.MeshPhysicalMaterial({ color: "#232528", roughness: 0.4, metalness: 0.1, specularIntensity: 0.6, clearcoat: 1, clearcoatRoughness: 0.04 });
const glass = new THREE.MeshPhysicalMaterial({ color: "#07090b", roughness: 0.04, metalness: 0.2, clearcoat: 1 });
const tyre = new THREE.MeshStandardMaterial({ color: "#151617", roughness: 0.9 });

/** Loads the car body; awaits `pause` between meshes, whose normals are rebuilt on the main thread. */
export async function loadCar(pause: () => Promise<void>): Promise<THREE.Group> {
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(carUrl);
  const meshes: THREE.Mesh[] = [];
  gltf.scene.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) meshes.push(c as THREE.Mesh);
  });
  for (const m of meshes) {
    m.castShadow = m.receiveShadow = true;
    const mat = m.material as THREE.MeshStandardMaterial;
    // Damage decals and motion-blur wheel discs are for other shots.
    if (/DAMAGE|Blur/.test(mat.name)) {
      m.removeFromParent();
      continue;
    }
    // The low-poly file ships positions only; smooth normals are rebuilt here.
    if (!m.geometry.getAttribute("normal")) {
      m.geometry.computeVertexNormals();
      await pause();
    }
    if (mat.name === "ext_carpaint") m.material = paint;
    else if (mat.name === "EXT_Window" || mat.name === "Black_Glass") m.material = glass;
    else if (mat.name === "Tyre") m.material = tyre;
    else {
      // Untextured trim must not turn into mirror chrome.
      mat.metalness = Math.min(mat.metalness, 0.5);
      mat.roughness = Math.max(mat.roughness, 0.35);
    }
  }
  return gltf.scene;
}

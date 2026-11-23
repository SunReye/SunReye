// Cuts the default car body (ADR 20) from "2024 Tesla Model 3 + Interior" by tonielpro520, CC BY 4.0,
// https://sketchfab.com/3d-models/61ddcbdbd3854c239e0c95bf60b00022: the outside only, without
// badges, plate, damage decals, textures or normals, simplified and meshopt-compressed.
// Usage: bun run car <downloaded.glb> [../../packages/builder/src/cars/car.glb]
import { NodeIO, type Document, type Primitive } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { dedup, prune, quantize, simplify, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";

/** The outside's materials; everything else (interior, badges, plate, brakes, damage) goes. */
const OUTSIDE = new Set([
  "ext_carpaint",
  "ext_carpaint_black",
  "ext_plastic",
  "EXT_Window",
  "EXT_Headlight_Glass",
  "Black_Glass",
  "Body_Black",
  "Lights",
  "Lights_Glo",
  "Lights_Ref",
  "Taillight_Detail",
  "Mirror",
  "RIM_2",
  "Tyre",
  "material",
]);

/** Simplification's error bound, as a share of the mesh's extent: about 4,000 triangles. */
const ERROR = 0.008;

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- gltf-transform reads it live.
function material(primitive: Primitive): string {
  return primitive.getMaterial()?.getName() ?? "";
}

/** Drops a primitive off the outside; keeps only the positions of the rest. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- gltf-transform edits in place.
function trim(primitive: Primitive): void {
  if (!OUTSIDE.has(material(primitive))) {
    primitive.dispose();

    return;
  }

  // The browser rebuilds smooth normals.
  for (const semantic of primitive.listSemantics()) {
    if (semantic !== "POSITION") primitive.setAttribute(semantic, null);
  }
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- gltf-transform edits in place.
function cut(document: Document): void {
  const root = document.getRoot();

  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) trim(primitive);
  }

  // Disposing a texture unlinks it from every material.
  for (const texture of root.listTextures()) texture.dispose();
}

const [source, target = "../../packages/builder/src/cars/car.glb"] = process.argv.slice(2);

if (source === undefined) throw new Error("usage: bun scripts/car.ts <downloaded.glb> [out.glb]");

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });

const document = await io.read(source);

cut(document);

await document.transform(
  prune(),
  dedup(),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: 0, error: ERROR }),
  prune(),
  quantize(),
);

for (const extension of document.getRoot().listExtensionsUsed()) {
  if (extension.extensionName === "EXT_texture_webp") extension.dispose();
}

document
  .createExtension(EXTMeshoptCompression)
  .setRequired(true)
  .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });

await io.write(target, document);

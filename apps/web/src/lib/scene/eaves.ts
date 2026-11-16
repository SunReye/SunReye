// How far each point of a pitched roof lies above its face's eave (ADR 20 Look): moss gathers
// in the first metres above the gutter, and the shader cannot see where that is.
import { BufferAttribute, BufferGeometry, Mesh, type Object3D, Vector3 } from "three";

/** A roof's triangles by the plane each lies in, and each plane's lowest point. */
interface Planes {
  readonly of: string[];
  readonly low: Map<string, number>;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's geometry, read only.
function planes(geometry: BufferGeometry): Planes {
  const position = geometry.getAttribute("position");
  const [a, b, c, normal] = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
  const of: string[] = [];
  const low = new Map<string, number>();

  for (let i = 0; i + 2 < position.count; i += 3) {
    a.fromBufferAttribute(position, i);
    b.fromBufferAttribute(position, i + 1);
    c.fromBufferAttribute(position, i + 2);
    normal.subVectors(b, a).cross(c.sub(a)).normalize();

    // Either winding names the same plane.
    if (normal.y < 0) normal.negate();

    const plane = [normal.x, normal.y, normal.z, normal.dot(a)].map((v) => v.toFixed(2)).join();

    of.push(plane);
    low.set(plane, Math.min(low.get(plane) ?? Infinity, a.y, b.y, position.getY(i + 2)));
  }

  return { of, low };
}

/** Gives a roof's geometry its `fall`: each point's metres above its face's eave, and 1 to say
 * it is known. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's geometry, set in place.
function fall(geometry: BufferGeometry): void {
  const position = geometry.getAttribute("position");
  const { of, low } = planes(geometry);
  const falls = new Float32Array(position.count * 2);

  for (let i = 0; i < position.count; i++) {
    const eave = low.get(of[Math.floor(i / 3)] ?? "") ?? position.getY(i);

    falls.set([position.getY(i) - eave, 1], i * 2);
  }

  geometry.setAttribute("fall", new BufferAttribute(falls, 2));
}

const isGeometry = (made: unknown): made is BufferGeometry => made instanceof BufferGeometry;

/** Every pitched roof under `root` knows its eaves. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's scene, set in place.
export function eaves(root: Object3D): void {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's part.
  root.traverse((part) => {
    const roof: unknown = part instanceof Mesh && part.name === "roof" ? part.geometry : null;

    if (isGeometry(roof) && !roof.hasAttribute("fall")) fall(roof);
  });
}

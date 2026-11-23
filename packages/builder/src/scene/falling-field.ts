import { BufferAttribute, BufferGeometry } from "three";

/** A seeded generator: the same field in every browser and on every draw. */
function seeded(seed: number): () => number {
  let state = seed;

  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;

    // The low bits of such a state repeat early: mixed down from the high ones.
    const mixed = Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) >>> 0;

    return ((mixed ^ (mixed >>> 12)) >>> 0) / 4_294_967_296;
  };
}

/** `count` places in the unit box, each `copies` times over, and a seed for each place. */
export function field(count: number, copies: number, seed: number): BufferGeometry {
  const random = seeded(seed);
  const places = new Float32Array(count * copies * 3);
  const seeds = new Float32Array(count * copies);

  for (let i = 0; i < count; i++) {
    const place = [random(), random(), random()];
    const own = random();

    for (let copy = 0; copy < copies; copy++) {
      places.set(place, (i * copies + copy) * 3);
      seeds[i * copies + copy] = own;
    }
  }

  const geometry = new BufferGeometry();

  geometry.setAttribute("position", new BufferAttribute(places, 3));
  geometry.setAttribute("seed", new BufferAttribute(seeds, 1));

  return geometry;
}

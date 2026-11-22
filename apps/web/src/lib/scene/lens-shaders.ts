// The shaders of the lens glass (ADR 23 "Scene weather"). The field is drawn small: where the
// glass bends the picture, where a drop shades it and where snow or frost whitens it. The glass
// then takes the picture through the field. Everything is seeded by its place and moved by the
// seconds handed in, so a frame drawn again is the same picture.

/** The middle of the picture the glass keeps clear, as a share of its half side: the plant
 * stays readable. */
const CLEAR = 0.55;

export const VERTEX = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SEEDED = `
  float hash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);

    q += dot(q, q.yzx + 33.33);

    return fract((q.x + q.y) * q.z);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);

    f = f * f * (3.0 - 2.0 * f);

    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }

  // How much the glass carries at a place: nothing in the middle, all of it at the rim.
  float rim(vec2 at) {
    vec2 off = abs(at / uSize - 0.5) * 2.0;

    return smoothstep(${CLEAR.toFixed(2)}, 1.0, max(off.x, off.y));
  }
`;

/** A grid of beads, `shift` aside so two grids never line up, each seeded in its cell: it swells,
 * stands and is gone, then the next. As xy the way from its centre in radii, and as z how much
 * of it is here. */
const BEADS = `
  vec3 beads(vec2 at, float shift, float cell, float age, float amount) {
    vec2 id = floor((at + shift) / cell);
    vec2 within = fract((at + shift) / cell) - 0.5;
    float seed = hash(id);
    float life = fract(age + hash(id + 31.7));
    float radius = (0.1 + 0.2 * seed) * smoothstep(0.0, 0.15, life);
    vec2 centre = (vec2(hash(id + 5.3), hash(id + 9.1)) - 0.5) * 0.36;
    // Whole beads or none: a bead is never cut where the glass thins out.
    float there = step(hash(id + 11.1), amount * rim((id + 0.5) * cell - shift));
    vec2 off = (within - centre) / max(radius, 0.001);
    off.y *= mix(0.80, 1.15, seed);
    float here = (1.0 - smoothstep(0.76, 1.0, length(off))) * there * (1.0 - smoothstep(0.85, 1.0, life));

    return vec3(off * here, here);
  }
`;

/** Drops that run down in columns, each with the trail it leaves; as the beads are. */
const RUNS = `
  const vec2 RUN = vec2(52.0, 180.0);

  vec3 runs(vec2 at, float seconds, float amount) {
    float column = floor(at.x / RUN.x);
    float speed = hash(vec2(column, 3.0));
    float phase = hash(vec2(column, 8.4)) * 6.283;
    float fallen = seconds * mix(28.0, 84.0, speed) - 10.0 * sin(seconds * 2.1 + phase);
    float row = floor((at.y - fallen) / RUN.y);
    vec2 id = vec2(column, row);
    vec2 within = vec2(fract(at.x / RUN.x), fract((at.y - fallen) / RUN.y));
    float seed = hash(id);
    float y = mix(0.68, 0.88, hash(id + 1.8));
    float x = mix(0.26, 0.74, seed) + sin(at.y * 0.036 + phase) * 0.07;
    vec2 off = (within - vec2(x, y)) * RUN;
    float radius = mix(3.5, 9.0, hash(id + 7.2));
    vec2 normal = off * vec2(1.0, mix(0.54, 0.80, speed)) / radius;
    float head = 1.0 - smoothstep(0.72, 1.0, length(normal));
    float taper = clamp(1.0 + off.y / mix(34.0, 105.0, seed), 0.0, 1.0);
    float width = mix(1.2, 3.6, taper * seed);
    float side = off.x / width;
    float trail = (1.0 - smoothstep(0.22, 1.0, abs(side))) * step(off.y, 0.0) * taper * taper * 0.52;
    vec2 centre = vec2((column + x) * RUN.x, (row + y) * RUN.y + fallen);
    float there = step(hash(id + 2.9), amount * 0.67) * rim(centre);
    vec2 bend = head * clamp(normal, -1.0, 1.0) + trail * vec2(clamp(side, -1.0, 1.0), 0.0);

    return vec3(bend * there, max(head, trail) * there);
  }
`;

/** Snow banked on the lower edge and drifted against the sides; it melts and settles again. */
const SETTLED = `
  float settled(vec2 at, float seconds, float amount) {
    float above = uSize.y - at.y;
    float aside = min(at.x, uSize.x - at.x);
    float melt = 0.75 + 0.25 * sin(seconds * 0.15 + noise(vec2(at.x / 140.0, 3.5)) * 6.283);
    // Deeper in the corners.
    float bank = (10.0 + 16.0 * noise(vec2(at.x / 55.0, 1.5)) + 24.0 * exp(-aside / 55.0)) * amount * melt;
    float drift = (5.0 + 10.0 * noise(vec2(at.y / 45.0, 7.5))) * amount * melt * smoothstep(0.5, 1.0, at.y / uSize.y);
    float grains = 0.65 + 0.35 * noise(at / 4.5);

    return grains * max(1.0 - smoothstep(bank - 6.0, bank, above), 1.0 - smoothstep(drift - 4.0, drift, aside));
  }
`;

/** Frost from the corners, then along the edges: ice crystals, each six needles with barbs
 * about a seed, large ones and small between them, over a thin haze of ice. */
const FROST = `
  // One crystal about its seed: p from the seed, reach its needles' length, turn its angle.
  // Folded into one needle's sixth of the turn.
  float crystal(vec2 p, float reach, float turn) {
    float r = length(p);
    float a = mod(atan(p.y, p.x) + turn, 1.0472) - 0.5236;
    float along = r * cos(a);
    float across = abs(r * sin(a));
    float needle = 1.0 - smoothstep(0.5, 1.5, across);
    // Barbs leave the needle at sixty degrees, shorter toward its tip.
    float rung = mod(along, reach * 0.16);
    float barb = (1.0 - smoothstep(0.4, 1.2, abs(across * 0.5 - rung * 0.866)))
      * (1.0 - smoothstep(0.0, 1.0, across - (reach - along) * 0.55));

    return max(needle, barb) * (1.0 - smoothstep(reach * 0.8, reach, along));
  }

  // The crystals seeded one to a cell, each reaching into the cells beside it.
  float crystals(vec2 at, float cell) {
    vec2 id = floor(at / cell);
    float most = 0.0;

    for (int x = -1; x <= 1; x++) {
      for (int y = -1; y <= 1; y++) {
        vec2 beside = id + vec2(float(x), float(y));
        vec2 seed = (beside + 0.5 + (vec2(hash(beside + 3.1), hash(beside + 7.7)) - 0.5) * 0.8) * cell;
        float reach = cell * (0.55 + 0.4 * hash(beside + 1.3));

        most = max(most, crystal(at - seed, reach, hash(beside + 5.9) * 1.0472));
      }
    }

    return most;
  }

  float frost(vec2 at, float amount) {
    vec2 edges = min(at, uSize - at) / (0.5 * min(uSize.x, uSize.y));
    float from = min(length(edges), min(edges.x, edges.y) * 4.0 + 0.3);
    float ice = max(crystals(at, 64.0), 0.7 * crystals(at + 31.0, 30.0));
    float reach = amount * 0.43;
    // A ragged front, which the crystals grow out past.
    float edge = from + (noise(at / 46.0) - 0.5) * 0.3 - ice * 0.08;

    return (1.0 - smoothstep(reach * 0.45, reach, edge)) * (0.16 + 0.60 * ice);
  }
`;

/**
 * The field: in red and green how far the glass bends the picture, about 128 of 255, which is
 * no bend at all; in blue how much of a drop is here; in alpha how much snow or frost.
 */
export const FIELD = `
  // The picture's size in the glass's own units, a CSS pixel at most.
  uniform vec2 uSize;
  uniform float uSeconds;
  // Rain, snow and frost, each 0 to 1.
  uniform vec3 uGlass;
  varying vec2 vUv;

  ${SEEDED}
  ${BEADS}
  ${RUNS}
  ${SETTLED}
  ${FROST}

  void main() {
    // From the upper left corner, down.
    vec2 at = vec2(vUv.x, 1.0 - vUv.y) * uSize;
    vec3 wet = vec3(0.0);
    vec2 bend = vec2(0.0);
    float white = 0.0;

    if (uGlass.x > 0.0) {
      vec3 large = beads(at, 0.0, 31.0, uSeconds * 0.05, uGlass.x * 0.8);
      vec3 small = beads(at, 13.7, 15.0, uSeconds * 0.08, uGlass.x * 0.24);

      wet = runs(at, uSeconds, uGlass.x);
      wet = large.z > wet.z ? large : wet;
      wet = small.z > wet.z ? small : wet;
      bend = wet.xy;
    }

    if (uGlass.y > 0.0) white = settled(at, uSeconds, uGlass.y);

    if (uGlass.z > 0.0) {
      float iced = frost(at, uGlass.z);

      white = max(white, iced * 0.9);
      bend += (vec2(noise(at / 5.0), noise(at / 5.0 + 9.0)) - 0.5) * iced * 0.6;
    }

    // Nothing at all in the middle, whatever spills over from a cell beside it.
    vec2 off = abs(vUv - 0.5) * 2.0;
    float clear = smoothstep(${CLEAR.toFixed(2)}, ${(CLEAR + 0.08).toFixed(2)}, max(off.x, off.y));

    bend = clamp(bend, -1.0, 1.0) * clear * vec2(1.0, -1.0);
    gl_FragColor = vec4((bend * 127.0 + 128.0) / 255.0, wet.z * clear, white * clear);
  }
`;

/** The picture through the field: bent, shaded under a drop, whitened under snow and frost.
 * After tone mapping, so the colours are the screen's. */
export const GLASS = `
  uniform sampler2D tDiffuse;
  uniform sampler2D tField;
  // The most the glass bends, as a share of the picture.
  uniform vec2 uBend;
  uniform float uShade;
  uniform vec3 uWhite;
  varying vec2 vUv;

  void main() {
    vec4 field = texture2D(tField, vUv);
    vec2 bend = (field.rg * 255.0 - 128.0) / 127.0;
    vec3 seen = texture2D(tDiffuse, vUv - bend * uBend).rgb;

    if (field.b > 0.0) {
      // A grazing edge catches the scene on the opposite side of the curved water.
      float rim = smoothstep(0.03, 0.40, length(bend)) * field.b;
      float facing = smoothstep(-0.08, 0.24, bend.y + bend.x * 0.35);
      vec3 caught = texture2D(tDiffuse, vUv + bend * uBend * 1.7).rgb;

      seen = mix(seen * (1.0 - rim * uShade), caught, rim * facing * 0.72);
    }
    gl_FragColor = vec4(mix(seen, uWhite, field.a), 1.0);
  }
`;

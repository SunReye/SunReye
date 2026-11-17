// The shaders of what falls (ADR 23 "Scene weather"): each place is seeded in a unit box, moved
// by one offset and wrapped round the box, so nothing is uploaded per frame.

/** A flake's width in metres: far over a real one's, which no screen would show. */
const FLAKE = 0.2;

/** Positions in the box wrap round it: what leaves below comes in above. */
const PLACED = `
  uniform vec3 uBox;
  uniform vec3 uOrigin;
  uniform vec3 uOffset;

  vec3 placed(vec3 seeded) {
    return mod(seeded * uBox + uOffset, uBox) + uOrigin;
  }
`;

const RAIN_VERTEX = `
  ${PLACED}
  uniform vec3 uStreak;
  attribute float tail;
  varying float vAlpha;

  void main() {
    // The tail trails where the drop came from, and fades, though not away: on the light page
    // half a streak would be lost.
    vAlpha = 1.0 - 0.6 * tail;
    gl_Position = projectionMatrix * viewMatrix * vec4(placed(position) - tail * uStreak, 1.0);
  }
`;

const SNOW_VERTEX = `
  ${PLACED}
  uniform float uPixels;
  attribute float seed;
  varying float vAlpha;

  void main() {
    vec3 at = placed(position);

    // It sways as it sinks: by its height, so it never jumps where the box wraps.
    at.x += sin(at.y * 1.7 + seed * 6.283) * 0.25;
    at.z += cos(at.y * 1.3 + seed * 12.566) * 0.25;

    vec4 seen = viewMatrix * vec4(at, 1.0);

    gl_Position = projectionMatrix * seen;

    float size = ${FLAKE.toFixed(3)} * (0.6 + 0.8 * seed) * projectionMatrix[1][1] * uPixels / -seen.z;

    // Under two pixels it thins instead of shrinking away.
    vAlpha = min(1.0, size / 2.0);
    // And a flake before the camera's nose is no blot.
    gl_PointSize = clamp(size, 2.0, 18.0);
  }
`;

const RAIN_FRAGMENT = `
  uniform vec3 uColour;
  uniform float uOpacity;
  varying float vAlpha;

  void main() {
    gl_FragColor = vec4(uColour, uOpacity * vAlpha);
  }
`;

const SNOW_FRAGMENT = `
  uniform vec3 uColour;
  uniform vec3 uRim;
  uniform float uOpacity;
  varying float vAlpha;

  void main() {
    vec2 at = (gl_PointCoord - 0.5) * 2.0;
    float off = length(at);
    // Lit from above: white on top, shaded below. White on a white page shows by its shade
    // alone, and a rim round it would make a bubble of it.
    float lit = smoothstep(-0.7, 0.45, -at.y) * (1.0 - 0.35 * off);
    float soft = 1.0 - smoothstep(0.55, 1.0, off);

    gl_FragColor = vec4(mix(uRim, uColour, lit), uOpacity * vAlpha * soft);
  }
`;

/** A streak: a line from the drop back along its fall. */
export const RAIN = { vertexShader: RAIN_VERTEX, fragmentShader: RAIN_FRAGMENT };

/** A flake: a soft point, white above and shaded below, its size in metres. */
export const SNOW = { vertexShader: SNOW_VERTEX, fragmentShader: SNOW_FRAGMENT };

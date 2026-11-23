// The shaders of what falls (ADR 23 "Scene weather"): each place is seeded in a unit box, moved
// by one offset and wrapped round the box, so nothing is uploaded per frame.
import { FOCUS_MODEL } from "./focus-shader.ts";

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

const SCENE_DEPTH = `
  uniform sampler2D tSceneDepth;
  uniform vec2 uDepthSize;

  void hideBehindScene() {
    if (uDepthSize.x > 0.0 &&
        gl_FragCoord.z > texture2D(tSceneDepth, gl_FragCoord.xy / uDepthSize).r) discard;
  }
`;

const PARTICLE_FOCUS = `
  ${FOCUS_MODEL}
  uniform float blurPixels;

  float defocus(float metres, vec4 clip) {
    float y = 0.5 + 0.5 * clip.y / max(clip.w, 0.001);

    return blurPixels * focusBlur(metres, y);
  }
`;

const RAIN_VERTEX = `
  ${PLACED}
  uniform vec3 uStreak;
  attribute float seed;
  attribute float tail;
  varying float vAlpha;

  void main() {
    float size = mix(0.58, 1.18, seed);
    vec4 seen = viewMatrix * vec4(placed(position) - tail * size * uStreak, 1.0);
    float depth = -seen.z;
    float distant = smoothstep(0.65, 3.3, depth / uBox.y);
    // Nearby drops catch more light. Those against the lens dissolve before they clip.
    vAlpha = mix(0.80, 1.0, seed) * (1.0 - 0.52 * tail) *
      mix(1.0, 0.23, distant) * smoothstep(0.2, 2.0, depth);

    gl_Position = projectionMatrix * seen;
  }
`;

const SNOW_VERTEX = `
  ${PLACED}
  ${PARTICLE_FOCUS}
  uniform float uPixels;
  attribute float seed;
  varying float vAlpha;
  varying float vSharpness;

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
    float radius = clamp(size, 2.0, 18.0) * 0.5;
    float spread = min(32.0, radius + defocus(-seen.z, gl_Position));
    vSharpness = radius / spread;
    gl_PointSize = 2.0 * spread;
  }
`;

const RAIN_FRAGMENT = `
  ${SCENE_DEPTH}
  uniform vec3 uColour;
  uniform float uOpacity;
  varying float vAlpha;

  void main() {
    hideBehindScene();
    gl_FragColor = vec4(uColour, uOpacity * vAlpha);
  }
`;

const SNOW_FRAGMENT = `
  ${SCENE_DEPTH}
  uniform vec3 uColour;
  uniform vec3 uRim;
  uniform float uOpacity;
  varying float vAlpha;
  varying float vSharpness;

  void main() {
    hideBehindScene();
    vec2 at = (gl_PointCoord - 0.5) * 2.0;
    float off = length(at);
    // Lit from above: white on top, shaded below. White on a white page shows by its shade
    // alone, and a rim round it would make a bubble of it.
    float lit = mix(0.75, smoothstep(-0.7, 0.45, -at.y) * (1.0 - 0.35 * off), vSharpness);
    float soft = 1.0 - smoothstep(mix(0.72, 0.55, vSharpness), 1.0, off);

    gl_FragColor = vec4(mix(uRim, uColour, lit), uOpacity * vAlpha * soft * vSharpness * vSharpness);
  }
`;

const RAIN_BOKEH_VERTEX = `
  ${PLACED}
  ${PARTICLE_FOCUS}
  uniform vec3 uStreak;
  uniform vec2 uDepthSize;
  attribute float seed;
  varying vec2 vStreak;
  varying vec3 vDrop;

  void main() {
    vec3 head = placed(position);
    vec3 travel = mix(0.58, 1.18, seed) * uStreak;
    vec4 seen = viewMatrix * vec4(head - travel * 0.5, 1.0);
    vec4 clip = projectionMatrix * seen;
    float metres = -seen.z;
    vec4 tip = projectionMatrix * viewMatrix * vec4(head, 1.0);
    vec4 tail = projectionMatrix * viewMatrix * vec4(head - travel, 1.0);
    vec2 streak = (tip.xy / max(tip.w, 0.2) - tail.xy / max(tail.w, 0.2)) * uDepthSize * 0.5;
    float span = min(40.0, length(streak));
    float radius = 0.65 + min(28.0, defocus(metres, clip));
    float size = span + 2.0 * radius + 1.0;
    float distant = smoothstep(0.65, 3.3, metres / uBox.y);
    float alpha = mix(0.80, 1.0, seed) * mix(1.0, 0.23, distant) * smoothstep(0.2, 2.0, metres);

    vStreak = streak * span / max(length(streak), 0.001);
    vDrop = vec3(min(64.0, size), radius, alpha);
    gl_PointSize = vDrop.x;
    gl_Position = clip;
  }
`;

const RAIN_BOKEH_FRAGMENT = `
  ${SCENE_DEPTH}
  uniform vec3 uColour;
  uniform float uOpacity;
  varying vec2 vStreak;
  varying vec3 vDrop;

  void main() {
    hideBehindScene();
    vec2 at = (gl_PointCoord - 0.5) * vDrop.x * vec2(1.0, -1.0);
    float t = clamp(dot(at, vStreak) / max(dot(vStreak, vStreak), 0.001), -0.5, 0.5);
    float distance = length(at - t * vStreak);
    float radius = vDrop.y;
    float coverage = 1.0 - smoothstep(max(0.0, radius * 0.72 - 0.4), radius + 0.4, distance);
    float span = length(vStreak);
    // A wider image spreads the same light across more pixels.
    float energy = (1.3 * span + 1.33) / (2.0 * radius * span + 3.14159 * radius * radius);

    gl_FragColor = vec4(uColour, uOpacity * vDrop.z * (0.74 + 0.52 * t) * coverage * energy);
  }
`;

/** A streak: a line from the drop back along its fall. */
export const RAIN = { vertexShader: RAIN_VERTEX, fragmentShader: RAIN_FRAGMENT };

export const RAIN_BOKEH = { vertexShader: RAIN_BOKEH_VERTEX, fragmentShader: RAIN_BOKEH_FRAGMENT };

/** A flake: a soft point, white above and shaded below, its size in metres. */
export const SNOW = { vertexShader: SNOW_VERTEX, fragmentShader: SNOW_FRAGMENT };

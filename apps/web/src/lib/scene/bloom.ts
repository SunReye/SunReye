// A faint bloom on the sun's glints for Hoch and Ultra (ADR 20 Look, Rendering quality): only
// what is brighter than the page's white spills, so the picture keeps its contrast.
import { Vector2 } from "three";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { untone } from "./light.ts";

/** What passes: above the threshold, and no brighter than three times it, so one glint of a
 * thousand times white does not flood the frame. */
const GLINTS = `
uniform sampler2D tDiffuse;
uniform float luminosityThreshold;
varying vec2 vUv;
void main() {
	vec4 texel = texture2D( tDiffuse, vUv );
	float v = luminance( texel.xyz );
	float over = smoothstep( luminosityThreshold, luminosityThreshold * 2.0, v );
	gl_FragColor = vec4( texel.rgb * over * min( 1.0, luminosityThreshold * 3.0 / max( v, 1e-4 ) ), 1.0 );
}`;

/**
 * The linear light from which a glint blooms: past the tone curve's white, and past the page's
 * own colour, which the backdrop holds and which must never glow onto the house.
 */
export function glintFrom(page: number, exposure: number): number {
  return Math.max(untone(0.985, exposure), untone(Math.min(page, 1), exposure) * 1.25);
}

/** The bloom pass, faint and tight. */
export function glints(): UnrealBloomPass {
  const pass = new UnrealBloomPass(new Vector2(256, 256), 0.22, 0.35, 12);

  pass.materialHighPassFilter.fragmentShader = GLINTS;

  return pass;
}

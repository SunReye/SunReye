// Contact-hardening shadows for Hoch and Ultra (ADR 20 Look, Rendering quality): a shadow is
// sharp where it touches what casts it and widens with the distance between them. three.js's
// own soft shadow blurs by one radius everywhere, so this replaces the sampling of its basic
// shadow map, the type that hands the shader raw depths: no other type is touched.
import { ShaderChunk } from "three";

/** The sun's apparent width, as the penumbra's metres per metre between caster and receiver:
 * about three suns wide, so the softening reads at a house's scale. */
const SUN = 0.028;

/** The widest penumbra in shadow-map texels, and so how far a caster is looked for. */
const WIDEST = 40;

/**
 * The shadow's radius for the sampling below: the penumbra's width in texels per unit of the
 * shadow camera's depth. `depth` is the camera's near to far and `across` its width, in metres,
 * and `texels` the map's side.
 */
export function penumbra(depth: number, across: number, texels: number): number {
  return (SUN * depth * texels) / across;
}

const SAMPLING = `
float softNoise( vec2 position ) {
	return fract( 52.9829189 * fract( dot( position, vec2( 0.06711056, 0.00583715 ) ) ) );
}

vec2 softDisk( int index, int count, float phi ) {
	float r = sqrt( ( float( index ) + 0.5 ) / float( count ) );
	float theta = float( index ) * 2.399963229728653 + phi;
	return vec2( cos( theta ), sin( theta ) ) * r;
}

// How the receiver's depth changes across the shadow map: a wide kernel on a slanted surface
// would otherwise shadow the surface with itself.
vec2 softSlope( vec3 coord ) {
	vec3 dx = dFdx( coord );
	vec3 dy = dFdy( coord );
	float det = dx.x * dy.y - dx.y * dy.x;
	if ( abs( det ) < 1e-12 ) return vec2( 0.0 );
	vec2 slope = vec2( dy.y * dx.z - dx.y * dy.z, dx.x * dy.z - dy.x * dx.z ) / det;
	return clamp( slope, vec2( -8.0 ), vec2( 8.0 ) );
}

float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
	float shadow = 1.0;
	shadowCoord.xyz /= shadowCoord.w;
	vec2 slope = softSlope( shadowCoord.xyz );
	shadowCoord.z += shadowBias;

	bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;

	if ( inFrustum && shadowCoord.z <= 1.0 ) {
		vec2 texel = vec2( 1.0 ) / shadowMapSize;
		float phi = softNoise( gl_FragCoord.xy ) * PI2;

		// What casts onto this point, and from how far.
		float casters = 0.0;
		float depth = 0.0;
		for ( int i = 0; i < 16; i ++ ) {
			vec2 offset = softDisk( i, 16, phi ) * texel * ${(WIDEST / 2).toFixed(1)};
			float found = texture2D( shadowMap, shadowCoord.xy + offset ).r;
			if ( found < shadowCoord.z + dot( offset, slope ) ) {
				casters += 1.0;
				depth += found;
			}
		}

		if ( casters > 0.0 ) {
			float width = clamp( ( shadowCoord.z - depth / casters ) * shadowRadius, 1.5, ${WIDEST.toFixed(1)} );
			float lit = 0.0;
			for ( int i = 0; i < 32; i ++ ) {
				vec2 offset = softDisk( i, 32, phi + 1.7 ) * texel * width * 0.5;
				lit += step( shadowCoord.z + dot( offset, slope ), texture2D( shadowMap, shadowCoord.xy + offset ).r );
			}
			shadow = lit / 32.0;
		}
	}

	return mix( 1.0, shadow, shadowIntensity );
}
`;

/** How three.js's chunk opens each sampling of a plain depth map, and closes every one. */
const OPENS = "float getShadow( sampler2D shadowMap,";
const CLOSES = /return mix\( 1\.0, shadow, shadowIntensity \);\s*\}/u;

/** The shadow chunk with the basic map, the last it samples, sampled as above. */
export function softened(chunk: string): string {
  const from = chunk.lastIndexOf(OPENS);
  const close = from < 0 ? null : CLOSES.exec(chunk.slice(from));

  // The basic map's is the one that compares a single depth.
  if (close === null || !chunk.slice(from, from + close.index).includes("shadow = step(")) {
    throw new Error("three.js's basic shadow sampling has moved");
  }

  return `${chunk.slice(0, from)}${SAMPLING.trim()}${chunk.slice(from + close.index + close[0].length)}`;
}

/** How three.js's vertex chunk finds the normal it offsets a shadow lookup along. */
const NORMAL =
  "vec3 shadowWorldNormal = transformNormalByInverseViewMatrix( transformedNormal, viewMatrix );";

/**
 * The shadow vertex chunk with that normal turned toward the camera. The crate promises no
 * winding, so a face's normal may point into its wall: the offset then pushes the lookup behind
 * the face, which shadows itself. A matte white wall shows that as speckle; the side seen is
 * the side shaded, so the offset belongs on it.
 */
export function faced(chunk: string): string {
  if (!chunk.includes(NORMAL)) throw new Error("three.js's shadow normal offset has moved");

  return chunk.replace(
    NORMAL,
    `${NORMAL}
		if ( dot( shadowWorldNormal, cameraPosition - worldPosition.xyz ) < 0.0 ) shadowWorldNormal = - shadowWorldNormal;`,
  );
}

let installed = false;

/** Programs made from here on sample a basic shadow map softly, and offset every shadow lookup
 * toward the camera's side of its face. */
export function softShadows(): void {
  if (installed) return;

  installed = true;
  ShaderChunk.shadowmap_pars_fragment = softened(ShaderChunk.shadowmap_pars_fragment);
  ShaderChunk.shadowmap_vertex = faced(ShaderChunk.shadowmap_vertex);
}

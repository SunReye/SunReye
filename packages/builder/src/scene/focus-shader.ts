export interface Focus {
  readonly tiltShift: boolean;
  readonly depthOfField: boolean;
}

/** The same focal plane and aperture for surfaces and transparent particles. */
export interface FocusFrame extends Focus {
  readonly focusDepth: number;
  readonly focusY: number;
  readonly plotRadius: number;
  readonly blurPixels: number;
}

export const FOCUS_MODEL = `
  uniform bool tiltShift;
  uniform bool depthOfField;
  uniform float focusDepth;
  uniform float focusY;
  uniform float plotRadius;

  float focusBlur(float metres, float y) {
    float tilt = tiltShift ? smoothstep(0.12, 0.40, abs(y - focusY)) : 0.0;
    if (!depthOfField) return tilt;

    // The near side of the focus slice defocuses faster than the far side.
    float outside = max(0.0, abs(metres - focusDepth) / plotRadius - 0.25);
    float magnification = clamp(focusDepth / max(metres, 0.1), 0.35, 2.0);
    return max(tilt, smoothstep(0.0, 0.75, outside * magnification));
  }
`;

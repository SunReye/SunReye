// Linear colour and the blends the studio's light is made of (ADR 20 Look). Pure.

/** Linear RGB, 0 to 1. */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** One sRGB byte, linear. */
function channel(byte: number): number {
  const c = byte / 255;

  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** sRGB hex to linear RGB. */
export function linear(hex: number): Rgb {
  return { r: channel(hex >> 16), g: channel((hex >> 8) & 0xff), b: channel(hex & 0xff) };
}

export function mix(from: number, to: number, k: number): number {
  return from + (to - from) * k;
}

export function smoothstep(from: number, to: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));

  return t * t * (3 - 2 * t);
}

export function blend(from: Rgb, to: Rgb, k: number): Rgb {
  return { r: mix(from.r, to.r, k), g: mix(from.g, to.g, k), b: mix(from.b, to.b, k) };
}

/** Relative luminance. */
export function luma({ r, g, b }: Rgb): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

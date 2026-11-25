// The colour each string is drawn in, by its position (ADR 20 Look). No three.js, so a screen that
// lists strings without drawing the scene loads none.

/** Strings by position, then again; distinct from roofs and the sky. */
export const STRINGS = [0x1f5fbf, 0xe08a00, 0x2a9d5c, 0xb8336a, 0x6a4fb5, 0x0f8b8d] as const;

/** A module on no string. */
export const UNASSIGNED = 0x6b6f76;

/** `stringColour` as CSS. */
export function stringCss(string: number | null | undefined): string {
  return `#${stringColour(string).toString(16).padStart(6, "0")}`;
}

/** The colour a string is drawn in, in the scene and in the builder's grid. */
export function stringColour(string: number | null | undefined): number {
  return string === null || string === undefined
    ? UNASSIGNED
    : (STRINGS[string % STRINGS.length] ?? UNASSIGNED);
}

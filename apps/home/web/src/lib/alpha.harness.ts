// Test helper: a computed colour's alpha, as the browser serialises it.

/**
 * The alpha of a computed colour: after the slash of a modern colour (`oklch(… / 0.64)`), the
 * fourth number of a legacy `rgba(…)`, 0 for `transparent`; 1 when it has none.
 */
export function alpha(colour: string): number {
  if (colour === "transparent") return 0;

  const modern = /\/\s*([\d.e-]+)\s*\)$/u.exec(colour)?.[1];

  if (modern !== undefined) return Number(modern);

  const legacy = /^rgba\((?:[^,]+,){3}\s*([\d.e-]+)\s*\)$/u.exec(colour)?.[1];

  return legacy === undefined ? 1 : Number(legacy);
}

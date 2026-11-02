/** The chosen profile id, or `null` once `profiles` no longer lists it. */
export function keptSelection(
  profiles: readonly { id: string }[],
  selectedId: string | null,
): string | null {
  return profiles.some((p) => p.id === selectedId) ? selectedId : null;
}

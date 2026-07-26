/**
 * Parse a text-field number: blank is a valid "unset" (null), anything else
 * must be a finite number. Settings forms bind numeric inputs as text so a
 * half-typed "-" or "" never coerces to 0; this is the shared parse step.
 */
export function parseNum(text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

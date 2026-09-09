// The text↔number rules every settings form shares. Fields are bound as text so a
// half-typed "-" or "" does not coerce to 0; these decide, once, what a blank box,
// a comma decimal and a kW-on-screen-watts-in-the-record field actually mean.

/** Reserve floor when the battery's reserve field is left blank. */
export const DEFAULT_RESERVE_PCT = 10;

/** A finite number, or null — `Number("")` is 0 and `parseFloat("12abc")` is 12. */
export function num(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed.replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

/** A blank field is a valid "unset"; a filled-but-unparseable one is not. */
export function optionalKw(text: string): {
  ok: boolean;
  watts: number | null;
} {
  if (text.trim() === "") return { ok: true, watts: null };
  const kw = num(text);
  return kw === null ? { ok: false, watts: null } : { ok: true, watts: kw * 1000 };
}

/** Watts as kW text; blank when unset. */
export const kwText = (w: number | null | undefined): string =>
  w == null ? "" : (w / 1000).toString();

// Search as the pickers do it: each word the admin types must begin one of an item's words.

/** Lower-case runs of letters and digits. */
export const tokens = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);

/** A name run together, so "Hi-MO 6" is found as "himo". */
export const compact = (text: string): string => tokens(text).join("");

/** The query's words, a number joined to the unit after it ("15 kW" is "15kw"). */
export const queryWords = (text: string): string[] =>
  tokens(text.replaceAll(/(\d)\s+(?=[a-z])/giu, "$1"));

/** Whether every wanted word begins one of `own`. */
export const found = (own: readonly string[], wanted: readonly string[]): boolean =>
  wanted.every((word) => own.some((w) => w.startsWith(word)));

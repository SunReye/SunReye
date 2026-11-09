/** Tableau 10: a legend names a series only once it has a colour. */
const COLOURS = [
  "#4e79a7",
  "#f28e2b",
  "#e15759",
  "#76b7b2",
  "#59a14f",
  "#edc948",
  "#b07aa1",
  "#ff9da7",
  "#9c755f",
  "#bab0ac",
] as const;

/** The colour of the `i`th series. */
export function colour(i: number): string {
  return COLOURS[i % COLOURS.length] ?? "currentColor";
}

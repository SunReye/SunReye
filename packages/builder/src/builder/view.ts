// The camera's view as the builder's consumers keep it (ADR 20), and the compass bearing it looks
// toward. Loads no three.js: a screen that draws no scene turns a view too.

/** Where the camera stands and what it looks at, in three.js's frame. */
export interface View {
  /** In three.js's frame: x east, y up, z south. */
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  /** It lands at once, without a flight: a hand turning the view moves it on each step. */
  readonly steady?: boolean | undefined;
}

/** The compass bearing `view` looks toward, degrees clockwise from north, 0 to 360: a compass
 * drawn over it points north at its negative. */
export function headingOf({ position, target }: View): number {
  const bearing = (Math.atan2(target[0] - position[0], position[2] - target[2]) * 180) / Math.PI;

  return (bearing + 360) % 360;
}

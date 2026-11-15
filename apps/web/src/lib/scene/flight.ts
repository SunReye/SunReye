// The camera's flight between views (ADR 20 Motion): ADR 21's ease-in-out, drawn only while it
// runs.
import { Spherical, Vector3 } from "three";
import { easeInOut } from "../motion/ease.ts";
import type { View } from "../builder/camera.ts";

/** ADR 20: the camera flies to a preset in about 600 ms. */
const FLIGHT_MS = 600;

/** The camera from `from` to `to` at linear progress 0 to 1, eased, circling the target the short
 * way round. */
export function course(from: View, to: View): (progress: number) => View {
  const start = new Spherical().setFromVector3(
    new Vector3(...from.position).sub(new Vector3(...from.target)),
  );

  const end = new Spherical().setFromVector3(
    new Vector3(...to.position).sub(new Vector3(...to.target)),
  );

  let { theta } = end;

  while (theta - start.theta > Math.PI) theta -= 2 * Math.PI;

  while (theta - start.theta < -Math.PI) theta += 2 * Math.PI;

  return (progress) => {
    const e = easeInOut(progress);
    const mix = (a: number, b: number): number => a + (b - a) * e;
    const target = new Vector3(...from.target).lerp(new Vector3(...to.target), e);

    const position = new Vector3()
      .setFromSpherical(
        new Spherical(
          mix(start.radius, end.radius),
          mix(start.phi, end.phi),
          mix(start.theta, theta),
        ),
      )
      .add(target);

    return { position: position.toArray(), target: target.toArray() };
  };
}

/** One camera flight at a time: a new one takes over from wherever the last had got to. It lands
 * at once while `still` holds (ADR 21). */
export class Flight {
  #step: ((now: number) => boolean) | undefined;
  readonly #still: () => boolean;

  constructor(still: () => boolean) {
    this.#still = still;
  }

  /** Flies the camera, through `place`, from `from` to `to`, starting at the next step. */
  fly(from: View, to: View, place: (view: View) => void): void {
    if (this.#still()) {
      this.#step = undefined;
      place(to);

      return;
    }

    const at = course(from, to);
    let start: number | undefined;

    this.#step = (now) => {
      start ??= now;
      const progress = Math.min(1, (now - start) / FLIGHT_MS);

      place(at(progress));

      return progress < 1;
    };
  }

  /** Grounds the flight: the admin's hand took the camera. */
  // fallow-ignore-next-line unused-class-member -- SceneCanvas calls it through `Lit["flight"]`.
  stop(): void {
    this.#step = undefined;
  }

  /** Moves the camera to where the flight is at `now`; true while it has yet to land. */
  get flying(): boolean {
    return this.#step !== undefined;
  }

  step(now: number): boolean {
    if (this.#step?.(now) !== true) this.#step = undefined;

    return this.#step !== undefined;
  }
}

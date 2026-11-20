/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM, used in place. */
// Test harness: what a chart entrance builds, read from the page's running animations.
import { expect } from "vitest";

export interface Built {
  readonly target: Element;
  /** Its first keyframe: where it starts from. */
  readonly from: Readonly<ComputedKeyframe>;
  /** ms. */
  readonly delay: number;
  /** `grow` starts from a scale, `draw` from a translate, `fade` from an opacity alone. */
  readonly build: "grow" | "draw" | "fade";
}

const buildOf = (from: Readonly<ComputedKeyframe>): Built["build"] => {
  if (from["scale"] !== undefined) return "grow";

  return from["translate"] === undefined ? "fade" : "draw";
};

/** Every CSS animation on the page: an entrance is one, a tween is a transition. */
export function built(): Built[] {
  return document.getAnimations().flatMap((a) => {
    const effect = a.effect;

    if (!(a instanceof CSSAnimation) || !(effect instanceof KeyframeEffect)) return [];

    const [from] = effect.getKeyframes();

    if (from === undefined || effect.target === null) return [];

    return [
      {
        target: effect.target,
        from,
        delay: Number(effect.getTiming().delay),
        build: buildOf(from),
      },
    ];
  });
}

/** Every animation on the page run to its end. */
export function finish(): void {
  for (const a of document.getAnimations()) a.finish();
}

const builds = () => built().map((b) => b.build);

/**
 * That the chart on the page builds up as it first shows, by `build`: a chart that grows live
 * only fades, any other builds as well as fading in.
 */
export async function expectBuilds(build: Built["build"]): Promise<void> {
  if (build !== "fade") {
    await expect.poll(builds).toContain(build);

    return;
  }

  await expect.poll(builds).not.toEqual([]);
  expect(builds().every((b) => b === "fade")).toBe(true);
}

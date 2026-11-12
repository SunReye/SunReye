// Local: tabs motion (#8): the sliding active indicator and the content crossfade. Durations
// come from the motion item; under reduced motion both happen at once (ADR 0003).
import { MOTION_EASE, MOTION_MS, motionMs, trackActive } from "#lib/motion.js";

const ACTIVE_TAB = ':scope > [data-state="active"], :scope > [data-active]';

/**
 * Keeps the box of a tabs list's active tab (a trigger with `data-state="active"` or a link with
 * `data-active`) in `--tabs-indicator-left|top|width|height` on the list and marks the list
 * `data-indicator` while there is one. The list draws the indicator from these variables
 * (`tabsListVariants`), so it slides from tab to tab on `--motion-base`. The tracking itself is
 * the motion item's `trackActive`, shared with the item list.
 */
export function trackIndicator(list: HTMLElement) {
  return trackActive(list, {
    active: ACTIVE_TAB,
    prefix: "tabs",
    attributes: ["data-state", "data-active", "data-orientation"],
  });
}

/**
 * Crossfades a tabs panel on a switch. The panel that becomes active fades in; the one that stops
 * being active stays drawn over it, out of the flow, inert and clipped to the incoming panel's
 * height, fading out, and is hidden after.
 */
export function crossfade(panel: HTMLElement) {
  let stop: (() => void) | undefined;

  const observer = new MutationObserver(() => {
    stop?.();
    const duration = motionMs(MOTION_MS.base);

    if (!duration) return;

    if (panel.dataset.state === "active") {
      const animation = panel.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration,
        easing: MOTION_EASE,
      });

      stop = () => animation.cancel();

      return;
    }

    const next = panel.parentElement?.querySelector<HTMLElement>(
      ':scope > [data-slot="tabs-content"][data-state="active"]',
    );

    if (!next) return;

    const style = panel.getAttribute("style");
    panel.hidden = false;
    panel.inert = true;
    // Clipped to the incoming panel's height, so a taller outgoing panel doesn't fade over the
    // content below the tabs (#30).
    Object.assign(panel.style, {
      position: "absolute",
      width: `${next.offsetWidth}px`,
      clipPath: `inset(0 0 max(0px, calc(100% - ${next.offsetHeight}px)) 0)`,
      pointerEvents: "none",
    });
    const from = panel.getBoundingClientRect();
    const to = next.getBoundingClientRect();
    panel.style.translate = `${to.left - from.left}px ${to.top - from.top}px`;

    const animation = panel.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration,
      easing: MOTION_EASE,
    });

    const end = () => {
      if (stop !== end) return;
      stop = undefined;
      animation.cancel();

      if (style === null) panel.removeAttribute("style");
      else panel.setAttribute("style", style);
      panel.inert = false;
      panel.hidden = panel.dataset.state !== "active";
    };

    stop = end;
    animation.onfinish = end;
  });

  observer.observe(panel, { attributes: true, attributeFilter: ["data-state"] });

  return () => {
    stop?.();
    observer.disconnect();
  };
}

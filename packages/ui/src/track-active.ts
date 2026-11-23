// A list's sliding selection indicator (#46), apart from the motion store so the kit needs no app state.

/** Whether `el`, or a wrapper of it below `list`, is out of the flow with an inline `position: absolute`: a row Svelte is fading out. */
function leaving(el: HTMLElement, list: HTMLElement) {
  for (let node: HTMLElement | null = el; node && node !== list; node = node.parentElement)
    if (node.style.position === "absolute") return true;

  return false;
}

/**
 * Keeps the box of a list's active child in `--<prefix>-indicator-left|top|width|height` on the
 * list and marks the list `data-indicator` while there is one. The list draws its indicator from
 * these variables with a `transition-[left,top,width,height]`, so a selection that switches
 * between siblings slides (and resizes) instead of snapping; `--motion-*` is 0 under reduced
 * motion, so it then jumps at once. The first box is set together with `data-indicator`, so
 * nothing animates in from nowhere, and neither does a list first laid out after `display: none`
 * (no box and no `data-indicator` while it has no layout). The list must be positioned (`relative`).
 *
 * - `active`: selector of the active child, matched anywhere under the list.
 * - `attributes`: attributes whose change moves the active child (`class` and `dir` are always
 *   watched: a `dir` flip on the list or any ancestor, or a class that re-aligns the list).
 * - `paddingBox`: measure the active child's padding box (inside its border), for a row whose
 *   border sits outside the indicator.
 * - `radius`: also keep the active child's corner radii in `--<prefix>-indicator-radius`, for an
 *   indicator that has to follow a child's rounding (a pill, or the end of a joined row).
 *
 * Positions come from layout (`offset*`), not from `getBoundingClientRect`, so a transform in
 * flight on a row or a wrapper (e.g. `animate:flip`) doesn't move the target.
 */
export function trackActive(
  list: HTMLElement,
  options: {
    active: string;
    prefix: string;
    attributes: string[];
    paddingBox?: boolean;
    radius?: boolean;
  },
) {
  const { active, prefix, attributes, paddingBox = false, radius = false } = options;
  let observed: Element | null = null;

  const place = () => {
    // Not a match inside a row Svelte is fading out: it stays in the DOM, out of the flow (inline
    // `position: absolute`), with its `aria-current` until the transition ends.
    const el = [...list.querySelectorAll<HTMLElement>(active)].find(
      (match) => !leaving(match, list),
    );

    if (!el) {
      list.removeAttribute("data-indicator");

      return;
    }

    if (el !== observed) {
      // A direct child of the list stays observed for its size, whether or not it is the active one.
      if (observed && observed.parentElement !== list) resizes.unobserve(observed);
      resizes.observe(el);
      observed = el;
    }

    // Not laid out (`display: none` on the list, an ancestor or the child): there is nothing to
    // measure, and the zeros it would give make the box grow from the top-left once the list is
    // shown. Drop the indicator, so the items' own look shows; the first measurement after the
    // list is laid out sets the box together with `data-indicator`, like the first paint.
    if (!list.getClientRects().length || !el.getClientRects().length) {
      list.removeAttribute("data-indicator");

      return;
    }

    // The position in the list's padding box: this element's own offset plus every positioned
    // ancestor's between it and the list.
    let left = el.offsetLeft;
    let top = el.offsetTop;

    for (let node = el.offsetParent; node && node !== list; node = node.offsetParent) {
      if (!(node instanceof HTMLElement)) break;
      left += node.offsetLeft + node.clientLeft;
      top += node.offsetTop + node.clientTop;
    }

    const box = paddingBox
      ? {
          left: left + el.clientLeft,
          top: top + el.clientTop,
          width: el.clientWidth,
          height: el.clientHeight,
        }
      : { left, top, width: el.offsetWidth, height: el.offsetHeight };

    for (const [name, px] of Object.entries(box))
      list.style.setProperty(`--${prefix}-indicator-${name}`, `${px}px`);

    if (radius) {
      // The four corners, each as horizontal and vertical radius (`a b c d / e f g h`).
      const style = getComputedStyle(el);

      const corners = (["TopLeft", "TopRight", "BottomRight", "BottomLeft"] as const).map(
        (corner) => style[`border${corner}Radius`].split(" "),
      );

      list.style.setProperty(
        `--${prefix}-indicator-radius`,
        `${corners.map((c) => c[0]).join(" ")} / ${corners.map((c) => c[1] ?? c[0]).join(" ")}`,
      );
    }

    list.setAttribute("data-indicator", "");
  };

  // Children change size when fonts load or their content does; the list when the layout does.
  const resizes = new ResizeObserver(place);

  const observeSizes = () => {
    resizes.disconnect();
    observed = null;
    resizes.observe(list);

    for (const child of list.children) resizes.observe(child);
  };

  const mutations = new MutationObserver((records) => {
    if (records.some((record) => record.type === "childList")) observeSizes();
    place();
  });

  mutations.observe(list, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [...attributes, "class", "dir"],
  });

  const directions = new MutationObserver((records) => {
    if (records.some((record) => record.target.contains(list))) place();
  });

  directions.observe(list.ownerDocument.documentElement, {
    subtree: true,
    attributes: true,
    attributeFilter: ["dir"],
  });
  observeSizes();
  place();

  return () => {
    mutations.disconnect();
    directions.disconnect();
    resizes.disconnect();
    // Not tracking any more: the list's own look (an item's, for a group that stops tracking).
    list.removeAttribute("data-indicator");
  };
}

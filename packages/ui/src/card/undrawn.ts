/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM, used in place. */
// What has come into the document since the last frame: a screen not drawn yet (ADR 21). What
// arrives with its screen, even a moment after its first render, takes no way in.

/** What was put into the document since the last frame, each the top of what came with it. */
let arrived: Node[] = [];
let frameAsked = false;

function took(records: readonly MutationRecord[]): void {
  // A hidden page draws no frame that would forget them.
  if (document.hidden) return;

  for (const record of records) arrived.push(...record.addedNodes);

  if (frameAsked) return;

  frameAsked = true;
  requestAnimationFrame(() => {
    arrived = [];
    frameAsked = false;
  });
}

// From the module's load, before any screen that asks: what came before is not known later.
const arrivals = typeof document === "undefined" ? undefined : new MutationObserver(took);

arrivals?.observe(document, { childList: true, subtree: true });

/**
 * Whether `node` stands inside something that came into the document since the last frame: its
 * screen is not drawn yet. `node` arriving alone, into what is drawn, is not.
 */
export function undrawn(node: Element): boolean {
  took(arrivals?.takeRecords() ?? []);

  return arrived.some((top) => top !== node && top.contains(node));
}

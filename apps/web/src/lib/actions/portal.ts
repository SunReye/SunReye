import type { Action } from "svelte/action";

/**
 * Move a node out to `document.body` while `active`, and put it back exactly
 * where it was when it is not.
 *
 * An expanded chart frame is `fixed inset-0`, and `position: fixed` resolves
 * against the nearest ancestor that establishes a containing block — which any
 * CSS `transform` does. `Dialog.Content` centres itself with
 * `-translate-x-1/2 -translate-y-1/2`, so a chart taken full screen from inside
 * a dialog filled the DIALOG rather than the screen: the frame measured a
 * correct 412x961 and was clipped to the card anyway. The same is true of
 * anything with `filter`, `backdrop-filter`, `will-change` or `contain`, so
 * fixing the one primitive would have left the class of bug open.
 *
 * The node stays Svelte's: it is put back before the component can unmount it,
 * and back in its ORIGINAL slot rather than appended, because Svelte inserts
 * relative to nodes it believes it knows the position of.
 */
export const portal: Action<HTMLElement, boolean> = (node, active = false) => {
  // Marks the node's place while it is away. A remembered index would not
  // survive siblings arriving or leaving in the meantime, and they do — the
  // history card's chart branches on range, loading and draft state.
  let anchor: Comment | null = null;

  function send(): void {
    if (anchor || !node.parentNode) return;
    anchor = document.createComment("portal");
    node.parentNode.insertBefore(anchor, node);
    document.body.appendChild(node);
  }

  function bring(): void {
    if (!anchor) return;
    anchor.parentNode?.insertBefore(node, anchor);
    anchor.parentNode?.removeChild(anchor);
    anchor = null;
  }

  const apply = (next: boolean) => (next ? send() : bring());
  apply(active);

  return {
    update: apply,
    destroy: bring,
  };
};

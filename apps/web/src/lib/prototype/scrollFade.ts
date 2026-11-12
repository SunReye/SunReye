// PROTOTYPE: no visible scrollbars; an edge fades where more content waits (ADR 21).
// The mask's stops are the only thing written, and only when an edge's state flips.
export function scrollFade(node: HTMLElement): () => void {
  let state = "";
  const update = (): void => {
    const l = node.scrollLeft > 1;
    const r = node.scrollLeft + node.clientWidth < node.scrollWidth - 1;
    const next = `${l}${r}`;
    if (next === state) return;
    state = next;
    const mask = l || r ? `linear-gradient(to right, ${l ? "transparent, #000 28px" : "#000 0"}, ${r ? "#000 calc(100% - 28px), transparent" : "#000 100%"})` : "";
    node.style.maskImage = mask;
    node.style.webkitMaskImage = mask;
  };
  update();
  node.addEventListener("scroll", update, { passive: true });
  const ro = new ResizeObserver(update);
  ro.observe(node);
  for (const c of node.children) ro.observe(c);
  return () => {
    node.removeEventListener("scroll", update);
    ro.disconnect();
  };
}

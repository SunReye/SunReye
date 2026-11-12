/** Moves a node to <body>, out of any transformed ancestor. */
export function portal(node: HTMLElement) {
  document.body.appendChild(node);
  return () => node.remove();
}

/**
 * Moving a node out to `document.body` while it needs to escape its ancestors,
 * and putting it back exactly where it was.
 *
 * Why it exists: an expanded chart frame is `fixed inset-0`, and `fixed`
 * resolves against the nearest ancestor that establishes a containing block —
 * which a CSS `transform` does. `Dialog.Content` centres itself with
 * `-translate-x-1/2 -translate-y-1/2`, so a chart taken full screen from inside
 * a dialog filled the DIALOG, not the screen. Rather than change a vendored
 * primitive every dialog in the app uses, the frame leaves the subtree.
 *
 * The half that can be wrong is the restore: Svelte still owns this node, and
 * putting it back anywhere but its original slot corrupts the component's view
 * of its own DOM. bun test has no DOM, so the tree here is a fake — the same
 * approach `in-view.test.ts` takes with IntersectionObserver.
 */

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { portal } from "./portal";

/** The slice of the DOM the action touches. */
class FakeNode {
  children: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  constructor(readonly name: string) {}

  appendChild(child: FakeNode): void {
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
  }

  insertBefore(child: FakeNode, ref: FakeNode | null): void {
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    const at = ref ? this.children.indexOf(ref) : -1;
    if (at === -1) this.children.push(child);
    else this.children.splice(at, 0, child);
  }

  removeChild(child: FakeNode): void {
    const at = this.children.indexOf(child);
    if (at !== -1) this.children.splice(at, 1);
    child.parentNode = null;
  }

  /** Sibling order by name — what a restore has to reproduce. */
  get order(): string[] {
    return this.children.map((c) => c.name);
  }
}

let body: FakeNode;
let parent: FakeNode;
let node: FakeNode;
let before: FakeNode;
let after: FakeNode;

const realDocument = globalThis.document;
let comments = 0;

beforeEach(() => {
  comments = 0;
  body = new FakeNode("body");
  parent = new FakeNode("parent");
  before = new FakeNode("before");
  node = new FakeNode("node");
  after = new FakeNode("after");
  for (const child of [before, node, after]) parent.appendChild(child);
  body.appendChild(parent);
  globalThis.document = {
    body,
    createComment: () => new FakeNode(`anchor${++comments}`),
  } as unknown as Document;
});

afterAll(() => {
  globalThis.document = realDocument;
});

/** The action, typed loosely enough to drive with the fake tree. */
const use = (target: FakeNode, active: boolean) =>
  portal(target as unknown as HTMLElement, active) as unknown as {
    update?: (active: boolean) => void;
    destroy?: () => void;
  };

describe("portal", () => {
  test("leaves the node alone while it is inactive", () => {
    // The overwhelmingly common case: every chart on the page that nobody has
    // expanded. It must cost nothing and place no anchor.
    use(node, false);
    expect(parent.order).toEqual(["before", "node", "after"]);
    expect(body.order).toEqual(["parent"]);
  });

  test("moves the node to the body when it is active", () => {
    use(node, true);
    expect(body.children.at(-1)!.name).toBe("node");
    expect(node.parentNode).toBe(body);
  });

  test("leaves an anchor where the node was", () => {
    // Not the index: siblings around it can come and go while it is away —
    // the history card's own chart branches on range and loading state.
    use(node, true);
    expect(parent.order).toEqual(["before", "anchor1", "after"]);
  });

  test("puts it back in its original slot, not at the end", () => {
    // Appending on the way back is the bug this test exists for: the node
    // would return AFTER its later siblings, and Svelte's next update would
    // insert around a node that is no longer where it thinks it is.
    const action = use(node, true);
    action.update?.(false);
    expect(parent.order).toEqual(["before", "node", "after"]);
  });

  test("restores correctly even when a sibling arrived while it was away", () => {
    const action = use(node, true);
    const extra = new FakeNode("extra");
    parent.insertBefore(extra, parent.children[0]!);
    action.update?.(false);
    expect(parent.order).toEqual(["extra", "before", "node", "after"]);
  });

  test("survives being toggled repeatedly without leaking anchors", () => {
    // Every expand places one and every collapse must take it away, or a card
    // the reader opens and closes a few times accumulates them.
    const action = use(node, true);
    for (let i = 0; i < 3; i++) {
      action.update?.(false);
      action.update?.(true);
    }
    action.update?.(false);
    expect(parent.order).toEqual(["before", "node", "after"]);
  });

  test("an update to the same value changes nothing", () => {
    const action = use(node, true);
    action.update?.(true);
    expect(body.children.filter((c) => c.name === "node")).toHaveLength(1);
    expect(parent.order).toEqual(["before", "anchor1", "after"]);
  });

  test("puts the node back when the component unmounts mid-flight", () => {
    // Svelte removes its own nodes on destroy, and it removes them from where
    // it believes they are. Left in the body, the frame outlives the component
    // that owns it — a chart card stuck over the page with nothing behind it.
    const action = use(node, true);
    action.destroy?.();
    expect(parent.order).toEqual(["before", "node", "after"]);
    expect(body.order).toEqual(["parent"]);
  });

  test("destroying while inactive is not an error", () => {
    const action = use(node, false);
    expect(() => action.destroy?.()).not.toThrow();
    expect(parent.order).toEqual(["before", "node", "after"]);
  });

  test("survives a node whose parent is gone", () => {
    // A detached subtree during teardown; the action must not throw inside a
    // destroy handler, which would abort the rest of the unmount.
    parent.removeChild(node);
    expect(() => use(node, true)).not.toThrow();
  });
});

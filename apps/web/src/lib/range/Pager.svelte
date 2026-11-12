<!--
  Content that changes place (ADR 21). A new `id` arrives one of two ways:
  - shift: a crossfade in place, moved a few px toward the side the new content belongs to.
  - keep: the same pane stays and its content moves by itself (a chart that morphs).
  A pane that is asked for again while it leaves is taken back, so a reversed switch continues from
  where it is. Only `transform` and `opacity` move. The prototype's finger-dragged `slide` waits for
  a screen that can draw its neighbour before the route reaches it.
-->
<script lang="ts" module>
  export interface Travel {
    kind: "shift" | "keep";
    dir: -1 | 0 | 1;
  }
</script>

<script lang="ts" generics="T">
  import { untrack, type Snippet } from "svelte";
  import { motion } from "../motion/tier.svelte.ts";

  const SHIFT = 12;
  const EXIT = 150;

  let {
    id,
    data,
    travel,
    after = 0,
    children,
  }: {
    id: string;
    data: T;
    /** How the content gets to a new id; read once, when the id changes. */
    travel: () => Travel;
    /** The new content waits this long, for text that would blur over the text it replaces. */
    after?: number;
    children: Snippet<[T]>;
  } = $props();

  interface Rec {
    uid: number;
    id: string;
    data: T;
    out: boolean;
    /** Where a crossfade comes from or leaves to, in px. */
    from: number;
    fade: boolean;
  }

  let uids = 0;

  let panes = $state.raw<Rec[]>([
    { uid: 0, id: untrack(() => id), data: untrack(() => data), out: false, from: 0, fade: false },
  ]);

  let cur = $state(0);
  let lastId = untrack(() => id);
  let lastData = untrack(() => data);
  const timers = new Map<number, ReturnType<typeof setTimeout>>();

  $effect.pre(() => {
    const [nextId, nextData] = [id, data];

    untrack(() => {
      if (nextId !== lastId) change(nextId, nextData, lastData);

      lastId = nextId;
      lastData = nextData;
    });
  });

  $effect(() => () => {
    for (const t of timers.values()) clearTimeout(t);
  });

  function change(nextId: string, nextData: T, oldData: T): void {
    const t = travel();
    const found = panes.find((p) => p.id === nextId && p.uid !== cur);

    if (found) {
      clearTimeout(timers.get(found.uid));
      timers.delete(found.uid);
    }

    if (t.kind === "keep" && !found) {
      panes = panes.map((p) => (p.uid === cur ? Object.assign({}, p, { id: nextId }) : p));

      return;
    }

    if (motion.still) {
      panes = [{ uid: ++uids, id: nextId, data: nextData, out: false, from: 0, fade: false }];
      cur = uids;

      return;
    }

    swap(found, nextId, nextData, oldData, t.kind === "shift" ? t.dir * SHIFT : 0);
  }

  /** The pane left behind keeps showing what it showed while it fades out. */
  function swap(found: Rec | undefined, nextId: string, nextData: T, oldData: T, dx: number): void {
    const gone = cur;

    const target: Rec = found
      ? Object.assign({}, found, { out: false })
      : { uid: ++uids, id: nextId, data: nextData, out: false, from: dx, fade: true };

    const kept = panes.map((p) => {
      if (p.uid === gone) return Object.assign({}, p, { data: oldData, out: true, from: -dx });

      return p.uid === target.uid ? target : p;
    });

    panes = found ? kept : [...kept, target];
    cur = target.uid;
    timers.set(
      gone,
      setTimeout(() => {
        timers.delete(gone);
        panes = panes.filter((p) => !(p.uid === gone && p.out));
      }, EXIT + 20),
    );
  }
</script>

<div class="pager" style:--after="{after}ms">
  {#each panes as p (p.uid)}
    <div
      class={["pane", p.uid !== cur && "aside", p.out && "out"]}
      style:--from="{p.from}px"
      inert={p.uid !== cur}
    >
      <div class={["inner", p.fade && "fade"]}>
        {@render children(p.uid === cur ? data : p.data)}
      </div>
    </div>
  {/each}
</div>

<style>
  .pager {
    position: relative;
  }
  .pane.aside {
    position: absolute;
    inset: 0 0 auto 0;
  }
  .inner {
    transition:
      opacity 220ms var(--motion-ease) var(--after),
      transform 220ms var(--motion-ease) var(--after);
  }
  @starting-style {
    .inner.fade {
      opacity: 0;
      transform: translateX(var(--from));
    }
  }
  /* Exits are shorter than entrances, on ease-in. */
  .out > .inner {
    opacity: 0;
    transform: translateX(var(--from));
    transition:
      opacity 150ms ease-in,
      transform 150ms ease-in;
  }
</style>

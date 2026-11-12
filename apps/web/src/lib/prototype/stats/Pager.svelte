<!--
  PROTOTYPE: content that changes place (ADR 21). A new `id` arrives one of three ways:
  - slide: the old pane leaves in the direction of travel and the new one follows it in. A finger
    drags the panes 1:1 with the neighbour already drawn beside it; on release a spring takes over
    at the finger's velocity. Arrows run the same travel on ease-in-out.
  - shift: a crossfade in place, moved a few px toward the side the new content belongs to.
  - keep: the same pane stays and its content moves by itself (a chart that morphs).
  A pane that is asked for again while it leaves is taken back, so a reversed switch continues from
  where it is. Only `transform` and `opacity` move.
-->
<script lang="ts" module>
  export interface Travel {
    kind: "slide" | "shift" | "keep";
    dir: -1 | 0 | 1;
  }
</script>

<script lang="ts" generics="T">
  import { untrack, type Snippet } from "svelte";
  import { spring, tween, VelocityTracker } from "../animate";
  import { motion } from "../motion/tier.svelte";
  import Pane from "./Pane.svelte";

  const GAP = 24;
  const SHIFT = 12;
  const EXIT = 150;

  let {
    id,
    data,
    travel,
    peek,
    onstep,
    after = 0,
    defer = false,
    children,
  }: {
    id: string;
    data: T;
    /** How the content gets to a new id; read once, when the id changes. */
    travel: () => Travel;
    /** The neighbour a drag uncovers, or null at the end of the record. */
    peek?: (dir: -1 | 1) => { id: string; data: T } | null;
    onstep?: (dir: -1 | 1) => void;
    /** The new content waits this long, for text that would blur over the text it replaces. */
    after?: number;
    /** Heavy content: build what arrives one frame after the switch. */
    defer?: boolean;
    children: Snippet<[T]>;
  } = $props();

  interface Rec {
    uid: number;
    id: string;
    data: T;
    /** Its place on the track, in pane widths. */
    slot: number;
    out: boolean;
    /** Where a crossfade comes from or leaves to, in px. */
    from: number;
    fade: boolean;
    instant: boolean;
    /** The height its placeholder keeps until its content mounts, a frame later. */
    hold: number;
  }
  let uids = 0;
  let panes = $state.raw<Rec[]>([{ uid: 0, id: untrack(() => id), data: untrack(() => data), slot: 0, out: false, from: 0, fade: false, instant: false, hold: 0 }]);
  let cur = $state(0);
  let root = $state<HTMLElement | null>(null);
  let track = $state<HTMLElement | null>(null);

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
    stop?.();
    for (const t of timers.values()) clearTimeout(t);
  });

  const slotOf = () => panes.find((p) => p.uid === cur)?.slot ?? 0;

  function change(nextId: string, nextData: T, oldData: T): void {
    const t = travel();
    const now = panes.find((p) => p.uid === cur)!;
    const found = panes.find((p) => p.id === nextId && p.uid !== cur);
    if (found) {
      clearTimeout(timers.get(found.uid));
      timers.delete(found.uid);
    }
    if (t.kind === "keep" && !found) {
      panes = panes.map((p) => (p.uid === cur ? { ...p, id: nextId } : p));
      return;
    }
    if (motion.still) {
      const only: Rec = { uid: ++uids, id: nextId, data: nextData, slot: 0, out: false, from: 0, fade: false, instant: true, hold: 0 };
      panes = [only];
      cur = only.uid;
      setX(0);
      return;
    }
    // The pane left behind keeps showing what it showed.
    let list = panes.map((p) => (p.uid === cur ? { ...p, data: oldData } : p));
    let target: Rec;
    if (t.kind === "slide") {
      target = found ? { ...found, out: false } : { uid: ++uids, id: nextId, data: nextData, slot: now.slot + (t.dir || 1), out: false, from: 0, fade: false, instant: true, hold: 0 };
      list = found ? list.map((p) => (p.uid === found.uid ? target : p)) : [...list, target];
      panes = list;
      cur = target.uid;
      slideTo(target.slot);
      return;
    }
    const dx = t.kind === "shift" ? t.dir * SHIFT : 0;
    list = list.map((p) => (p.uid === cur ? { ...p, out: true, from: -dx } : p));
    target = found ? { ...found, out: false, slot: now.slot } : { uid: ++uids, id: nextId, data: nextData, slot: now.slot, out: false, from: dx, fade: true, instant: false, hold: defer ? (root?.offsetHeight ?? 0) : 0 };
    panes = found ? list.map((p) => (p.uid === found.uid ? target : p)) : [...list, target];
    cur = target.uid;
    const gone = now.uid;
    timers.set(
      gone,
      setTimeout(() => {
        timers.delete(gone);
        panes = panes.filter((p) => !(p.uid === gone && p.out));
      }, EXIT + 20),
    );
  }

  // ── The track: one transform, driven by a tween or a spring, or by the finger ──
  let x = 0;
  let stop: (() => void) | undefined;
  let dragging = false;
  let releaseV: number | null = null;

  const width = () => (root?.offsetWidth ?? 0) + GAP;
  function setX(v: number): void {
    x = v;
    if (track) track.style.transform = v ? `translateX(${v.toFixed(2)}px)` : "";
  }
  function slideTo(slot: number): void {
    stop?.();
    const to = -slot * width();
    if (releaseV !== null) stop = spring(x, to, setX, { velocity: releaseV, stiffness: 320, damping: 36 }, settle);
    else stop = tween(x, to, 300, setX, settle);
    releaseV = null;
  }
  /** At rest: only the current pane is left, at the track's origin. */
  function settle(): void {
    if (dragging) return;
    panes = panes.filter((p) => p.uid === cur || p.out).map((p) => ({ ...p, slot: 0 }));
    setX(0);
  }

  /** On the surface a finger may drag: `{@attach pager.swipe}`. A chart (`data-scrub`) keeps its own touch. */
  export function swipe(node: HTMLElement): () => void {
    const speed = new VelocityTracker();
    let pid = -1;
    let [sx, sy, x0, dx0] = [0, 0, 0, 0];
    /** 0 undecided, 1 ours, -1 the page's scroll. */
    let mine = 0;
    const none = new Set<number>();

    const has = (dir: number) => panes.some((p) => p.slot === slotOf() + dir && !p.out);
    function uncover(dir: -1 | 1): void {
      if (has(dir) || none.has(dir)) return;
      const next = peek?.(dir);
      if (!next) {
        none.add(dir);
        return;
      }
      panes = [...panes.filter((p) => p.id !== next.id), { uid: ++uids, id: next.id, data: next.data, slot: slotOf() + dir, out: false, from: 0, fade: false, instant: true, hold: 0 }];
    }
    function down(e: PointerEvent): void {
      if (e.pointerType === "mouse" || !peek || (e.target as Element).closest("[data-scrub]")) return;
      [pid, sx, sy, mine] = [e.pointerId, e.clientX, e.clientY, 0];
      none.clear();
      speed.reset();
    }
    function move(e: PointerEvent): void {
      if (e.pointerId !== pid || mine < 0) return;
      const [dx, dy] = [e.clientX - sx, e.clientY - sy];
      if (!mine) {
        if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) mine = -1;
        if (mine < 0 || Math.abs(dx) < 10 || motion.still) return;
        mine = 1;
        dragging = true;
        stop?.();
        [x0, dx0] = [x, dx];
        node.setPointerCapture(pid);
      }
      const rest = -slotOf() * width();
      const want = x0 + (dx - dx0) - rest;
      const dir = want < 0 ? 1 : -1;
      uncover(dir);
      // Nothing beyond the record: the pane gives a little and no more.
      setX(rest + (has(dir) ? want : want * 0.22));
      speed.push(e.clientX);
    }
    function up(e: PointerEvent): void {
      if (e.pointerId !== pid) return;
      pid = -1;
      const dx = e.clientX - sx;
      if (mine !== 1) {
        // Still tier: no travel, the swipe just steps.
        if (motion.still && mine === 0 && Math.abs(dx) > 48 && Math.abs(e.clientY - sy) < 36) onstep?.(dx > 0 ? -1 : 1);
        return;
      }
      dragging = false;
      const v = e.type === "pointercancel" ? 0 : speed.velocity();
      const moved = x + slotOf() * width();
      const dir = moved < 0 ? 1 : -1;
      const flung = Math.abs(v) > 450 && Math.sign(v) === Math.sign(moved);
      releaseV = v;
      if (e.type !== "pointercancel" && has(dir) && (Math.abs(moved) > width() * 0.28 || flung)) {
        const before = cur;
        onstep?.(dir);
        // The route did not follow: back to rest.
        setTimeout(() => cur === before && !dragging && (stop?.(), slideTo(slotOf())), 500);
      } else slideTo(slotOf());
    }
    node.style.touchAction = "pan-y";
    node.addEventListener("pointerdown", down);
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", up);
    return () => {
      node.removeEventListener("pointerdown", down);
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", up);
      node.removeEventListener("pointercancel", up);
    };
  }
</script>

<div class="pager" bind:this={root} style:--after="{after}ms">
  <div class="track" bind:this={track}>
    {#each panes as p (p.uid)}
      <div class={["pane", p.uid !== cur && "aside", p.out && "out"]} style:--slot={p.slot} style:--from="{p.from}px" inert={p.uid !== cur}>
        <div class={["inner", p.fade && "fade"]}>
          <Pane data={p.uid === cur ? data : p.data} instant={p.instant} hold={p.hold} {children} />
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .pager {
    position: relative;
  }
  .pane {
    transform: translateX(calc(var(--slot) * (100% + 24px)));
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

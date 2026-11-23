<!--
  Content that changes place (ADR 21). A new `id` arrives one of three ways:
  - slide: the old pane leaves in the direction of travel and the new one follows it in. A finger
    drags the panes 1:1 with the neighbour already drawn beside it; on release a spring takes over
    at the finger's velocity.
  - shift: a crossfade in place, moved a few px toward the side the new content belongs to.
  - keep: the same pane stays and its content moves by itself (a chart that morphs).
  A pane that is asked for again while it leaves is taken back, so a reversed switch continues from
  where it is. Only `transform` and `opacity` move.
  A pane that slides is seen all the way, a finger's neighbour too: on a card whose height it
  changes, only a pane swapped in place is held back until the card has its height (ADR 21).
-->
<script lang="ts" generics="T">
  import { untrack, type Snippet } from "svelte";
  import { spring, tween } from "../animate.ts";
  import { slideTiming } from "../motion/slide.ts";
  import { motion } from "@sunreye/builder/motion/tier.svelte.ts";
  import { EXIT_MS, SPRINGS } from "../motion/values.ts";
  import Pane from "./Pane.svelte";
  import type { Travel } from "./travel.svelte.ts";
  import { drag } from "./pager-drag.ts";

  const GAP = 24;
  const SHIFT = 12;

  let {
    id,
    data,
    travel,
    peek,
    onstep,
    after = 0,
    defer = false,
    surface = null,
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
    /** Heavy content: build what fades in two frames after the switch. */
    defer?: boolean;
    /** Where a finger may drag the panes; a chart in it (`data-scrub`) keeps its own touch. */
    surface?: HTMLElement | null;
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
    /** The height its placeholder keeps until its content mounts. */
    hold: number;
  }

  // The first pane takes uid 0.
  let uids = -1;

  const rec = (r: Pick<Rec, "id" | "data" | "slot"> & Partial<Rec>): Rec =>
    Object.assign({ uid: ++uids, out: false, from: 0, fade: false, hold: 0 }, r);

  let panes = $state.raw<Rec[]>([
    rec({ id: untrack(() => id), data: untrack(() => data), slot: 0 }),
  ]);

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
      const only = rec({ id: nextId, data: nextData, slot: 0 });

      panes = [only];
      cur = only.uid;
      setX(0);

      return;
    }

    // The pane left behind keeps showing what it showed.
    const kept = panes.map((p) => (p.uid === cur ? Object.assign({}, p, { data: oldData }) : p));

    if (t.kind === "slide") slide(kept, found, nextId, nextData, t.dir);
    else swap(kept, found, nextId, nextData, t.kind === "shift" ? t.dir * SHIFT : 0);
  }

  function slide(list: Rec[], found: Rec | undefined, nextId: string, nextData: T, dir: number) {
    const target = found
      ? Object.assign({}, found, { out: false })
      : rec({ id: nextId, data: nextData, slot: slotOf() + (dir || 1) });

    panes = found ? list.map((p) => (p.uid === found.uid ? target : p)) : [...list, target];
    cur = target.uid;
    slideTo(target.slot);
  }

  function swap(list: Rec[], found: Rec | undefined, nextId: string, nextData: T, dx: number) {
    const gone = cur;
    const slot = slotOf();
    const hold = defer ? (root?.offsetHeight ?? 0) : 0;

    const target = found
      ? Object.assign({}, found, { out: false, slot })
      : rec({ id: nextId, data: nextData, slot, from: dx, fade: true, hold });

    const left = list.map((p) =>
      p.uid === gone ? Object.assign({}, p, { out: true, from: -dx }) : p,
    );

    panes = found ? left.map((p) => (p.uid === found.uid ? target : p)) : [...left, target];
    cur = target.uid;
    timers.set(
      gone,
      setTimeout(() => {
        timers.delete(gone);
        panes = panes.filter((p) => !(p.uid === gone && p.out));
      }, EXIT_MS + 20),
    );
  }

  // The track: one transform, driven by a tween or a spring, or by the finger.
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

    const { duration, easing } = slideTiming();

    stop =
      releaseV === null
        ? tween(x, to, duration, setX, settle, easing)
        : spring(x, to, setX, { ...SPRINGS.pager, velocity: releaseV }, settle);
    releaseV = null;
  }

  /** At rest: only the current pane is left, at the track's origin. */
  function settle(): void {
    if (dragging) return;

    panes = panes
      .filter((p) => p.uid === cur || p.out)
      .map((p) => Object.assign({}, p, { slot: 0 }));
    setX(0);
  }

  const has = (dir: number) => panes.some((p) => p.slot === slotOf() + dir && !p.out);

  $effect(() => {
    if (!surface) return;

    const none = new Set<number>();

    return drag(surface, {
      enabled: () => peek !== undefined,
      still: () => motion.still,
      start: () => {
        none.clear();
        dragging = true;
        stop?.();

        return x;
      },
      move: (want) => {
        const rest = -slotOf() * width();
        const dir = want - rest < 0 ? 1 : -1;

        uncover(dir, none);
        // Nothing beyond the record: the pane gives a little and no more.
        setX(rest + (has(dir) ? want - rest : (want - rest) * 0.22));
      },
      release: (v, cancelled) => {
        dragging = false;
        release(v, cancelled);
      },
      step: (dir) => onstep?.(dir),
    });
  });

  function uncover(dir: -1 | 1, none: Set<number>): void {
    if (has(dir) || none.has(dir)) return;

    const next = peek?.(dir);

    if (!next) {
      none.add(dir);

      return;
    }

    panes = [
      ...panes.filter((p) => p.id !== next.id),
      rec({ id: next.id, data: next.data, slot: slotOf() + dir }),
    ];
  }

  function release(v: number, cancelled: boolean): void {
    const moved = x + slotOf() * width();
    const dir = moved < 0 ? 1 : -1;
    const flung = Math.abs(v) > 450 && Math.sign(v) === Math.sign(moved);

    releaseV = v;

    if (cancelled || !has(dir) || (Math.abs(moved) <= width() * 0.28 && !flung)) {
      slideTo(slotOf());

      return;
    }

    const before = cur;

    onstep?.(dir);
    // The route did not follow: back to rest.
    setTimeout(() => {
      if (cur === before && !dragging) slideTo(slotOf());
    }, 500);
  }
</script>

<div class="pager" bind:this={root} style:--after="{motion.still ? 0 : after}ms">
  <div class="track" bind:this={track}>
    {#each panes as p (p.uid)}
      <div
        class={["pane", p.uid !== cur && "aside", p.out && "out"]}
        style:--slot={p.slot}
        style:--from="{p.from}px"
        inert={p.uid !== cur}
        data-glide-shown={p.fade ? undefined : ""}
      >
        <div class={["inner", p.fade && "fade"]}>
          <Pane data={p.uid === cur ? data : p.data} hold={p.hold} {children} />
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
      opacity var(--motion-slow) var(--motion-ease) var(--after),
      transform var(--motion-slow) var(--motion-ease) var(--after);
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
      opacity var(--motion-exit) var(--motion-ease-exit),
      transform var(--motion-exit) var(--motion-ease-exit);
  }
</style>

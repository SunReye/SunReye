<!--
  ADR 21's drill-in for Controls and Settings: a root list of groups, each row summarising its values.
  Below 1024 px each level is a screen of its own, with no card around both: a row slides its page in
  from the right while the root shifts left and dims; an edge-swipe follows the finger back. From
  1024 px the two levels sit side by side instead and nothing slides. The open group is the caller's
  hash route: `open` follows it, `onnavigate` asks to change it.
-->
<script lang="ts" module>
  import type { Component } from "svelte";

  export interface DrillGroup {
    readonly id: string;
    readonly label: string;
    /** Its current values in a few words, under the label. */
    readonly summary?: string;
    readonly icon?: Component<{ class?: string }>;
    /** Listed but not open, such as a setup step not yet reached. */
    readonly disabled?: boolean;
  }

  /** The screen a heading is drawn on: the root list, or an open group's page on the phone. */
  export type DrillLevel = "root" | "page";
</script>

<script lang="ts">
  import { tick, untrack, type Snippet } from "svelte";
  import { MediaQuery } from "svelte/reactivity";
  import * as Card from "#lib/components/ui/card/index.js";
  import * as Item from "../ui/item/index.js";
  import { spring, tween, VelocityTracker } from "../../animate.ts";
  import { haptics } from "../../haptics.ts";
  import { released, settle, slideMs } from "./drill.ts";
  import DrillHeader from "./drill-header.svelte";
  import DrillPanes from "./drill-panes.svelte";
  import DrillRow from "./drill-row.svelte";

  let {
    groups,
    open,
    onnavigate,
    back,
    label = back,
    heading,
    page,
  }: {
    groups: readonly DrillGroup[];
    /** The open group's id, from the hash route; null on the root. */
    open: string | null;
    /** Push the group's hash route, or go back for null. */
    onnavigate: (id: string | null) => void;
    /** The root's title, on the child page's back button. */
    back: string;
    /** The group list's name for assistive tech in two panes. */
    label?: string;
    /** Above the root's list, and above a page's header for what must stay in sight there. */
    heading?: Snippet<[DrillLevel]>;
    page: Snippet<[DrillGroup]>;
  } = $props();

  // Two panes from 1024 px (ADR 21).
  const split = new MediaQuery("(min-width: 1024px)");

  // The page on screen: it stays while it slides out after the route has left it, so it is seeded
  // from the route once and then moved by the slide.
  // svelte-ignore state_referenced_locally
  let shown = $state<string | null>(open);

  // 0 on the root, 1 on the page; seeded from the route at mount.
  // svelte-ignore state_referenced_locally
  let p = $state(open === null ? 0 : 1);

  // The route at mount seeds the slide; the effect below follows every later route.
  // svelte-ignore state_referenced_locally
  let target: 0 | 1 = open === null ? 0 : 1;

  // The page covers the root, which is then left out of the layout.
  // svelte-ignore state_referenced_locally
  let covered = $state(open !== null);

  // Both levels scroll with the window, yet each keeps a place of its own: the level the slide
  // heads for owns the window's scroll, and the other is drawn `lift` px off so it stays where it
  // was. The router scrolls too (a pushed level to its top, back to the root's place), at a time
  // of its own, so the places follow the window's scroll events rather than being read at a turn.
  let rootY = 0;
  let pageY = 0;
  let rootLift = $state(0);
  let pageLift = $state(0);

  // The page's header sticks to the screen's top, which the window's scroll decides: while the
  // page is drawn off its place the header is too, back to where the page's own scroll had it.
  const STUCK = 12;
  const GAP = 16;
  let head: HTMLDivElement | undefined = $state();
  let level: HTMLDivElement | undefined = $state();
  let headAt = 0;
  let headLift = $state(0);

  /** The header's top on the screen with the window scrolled to `y`. */
  const headTop = (y: number) => Math.max(headAt - y, STUCK);

  const scrollToY = (y: number) => {
    scrollTo({ top: y, behavior: "instant" });
  };

  function follow(): void {
    if (split.current) return;

    if (target === 1) {
      pageY = scrollY;
      pageLift = 0;
      headLift = 0;
      rootLift = scrollY - rootY;
    } else {
      rootY = scrollY;
      rootLift = 0;
      pageLift = scrollY - pageY;
      headLift = headTop(pageY) - headTop(scrollY) - pageLift;
    }
  }

  /** Hands the window's scroll to the level the slide now heads for. */
  async function turn(to: 0 | 1): Promise<void> {
    // A page newly opened starts at its top.
    if (to === 1 && p === 0) pageY = 0;

    // Where the header lies in the document, read while the page is still in its place.
    if (to === 0 && head && level)
      headAt = level.getBoundingClientRect().top + scrollY - head.offsetHeight - GAP;

    target = to;
    covered = false;
    // Once the root is laid out again, so its place can be reached, and before the next frame.
    await tick();
    scrollToY(to === 1 ? pageY : rootY);
    follow();
  }

  let cancel: (() => void) | undefined;
  let box: HTMLDivElement | undefined = $state();

  const group = $derived(groups.find((g) => g.id === shown));
  const pane = $derived(groups.find((g) => g.id === open) ?? groups[0]);

  // The route moved (a row, back, the back button): slide to it from wherever the slide is.
  $effect(() => {
    const want = open === null ? 0 : 1;

    // Another page in the open one's place, as setup's next step, starts at its top.
    if (open !== null && untrack(() => shown !== null && shown !== open) && !split.current)
      scrollToY(0);

    if (open !== null) shown = open;

    if (want === target) return;

    // Two panes have nothing to slide.
    if (split.current) {
      target = want;
      p = want;
      covered = want === 1;

      if (want === 0) shown = null;

      return;
    }

    untrack(() => {
      slide(want);
    });
  });

  function slide(to: 0 | 1, velocity?: number): void {
    cancel?.();

    if (to !== target) void turn(to);

    const done = () => {
      cancel = undefined;

      if (to === 0) shown = null;
      else covered = true;

      haptics.soft();
    };

    const set = (value: number) => {
      p = value;
    };

    // A release keeps its velocity; anything else runs the ease-in-out from where it is. Both land
    // at once on the still tier.
    cancel =
      velocity === undefined
        ? tween(p, to, slideMs(p, to), set, done)
        : spring(p, to, set, released(velocity), done);
  }

  /** Two panes: show a group's page on the right; nothing slides. */
  function pick(id: string): void {
    if (id === pane?.id) return;

    haptics.selection();
    onnavigate(id);
  }

  // Edge-swipe back.
  const tracker = new VelocityTracker();
  let swipe: { id: number; x0: number; p0: number; active: boolean } | undefined;

  function down(e: PointerEvent): void {
    if (shown === null || !box) return;

    if (e.clientX - box.getBoundingClientRect().left > 28) return;

    swipe = { id: e.pointerId, x0: e.clientX, p0: p, active: false };
    tracker.reset();
  }

  function move(e: PointerEvent): void {
    if (!swipe || e.pointerId !== swipe.id || !box) return;

    const dx = e.clientX - swipe.x0;

    if (!swipe.active && dx > 6) {
      swipe.active = true;
      cancel?.();
      // The root shows under the page again, where it was left.
      covered = false;
      follow();
      box.setPointerCapture(e.pointerId);
    }

    if (!swipe.active) return;

    p = Math.max(0, Math.min(1, swipe.p0 - dx / box.offsetWidth));
    tracker.push(p);
  }

  function up(e: PointerEvent): void {
    if (!swipe || e.pointerId !== swipe.id) return;

    const { active } = swipe;

    swipe = undefined;

    if (!active) return;

    const velocity = tracker.velocity();
    const to = settle(p, velocity);

    slide(to, velocity);

    if (to === 0) onnavigate(null);
  }
</script>

<svelte:window onscroll={follow} />

{#if split.current}
  <DrillPanes {groups} {pane} onpick={pick} {label} {heading} {page} />
{:else}
  <!-- No surface holds both levels, so none changes size as they trade places. -->
  <div
    bind:this={box}
    data-drill="box"
    class="mx-auto grid w-full max-w-2xl touch-pan-y grid-cols-[minmax(0,1fr)] overflow-x-clip"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    role="presentation"
  >
    <!-- Gone once the page covers it: the page alone gives the window its height. -->
    <section
      class={[
        "col-start-1 row-start-1 flex min-w-0 flex-col gap-4 self-start px-4 py-6",
        covered && "hidden",
      ]}
      style:transform="translateX({-30 * p}%) translateY({rootLift}px)"
      style:opacity={1 - 0.6 * p}
      aria-hidden={p > 0.5}
      inert={p > 0.5}
    >
      <!-- Once only while the page covers the root: the page draws it too. -->
      {#if !covered}{@render heading?.("root")}{/if}
      <Card.Root class="glass-ambient gap-0 py-0">
        <Item.Group class="gap-0 divide-y divide-border/60">
          {#each groups as g (g.id)}
            <DrillRow group={g} onclick={() => onnavigate(g.id)} />
          {/each}
        </Item.Group>
      </Card.Root>
    </section>

    {#if group}
      <section
        data-drill="page"
        class="col-start-1 row-start-1 flex min-w-0 flex-col gap-4 self-start px-4 py-6"
        style:transform="translateX({(1 - p) * 100}%) translateY({pageLift}px)"
        aria-label={group.label}
      >
        {@render heading?.("page")}
        <!-- At the top of the screen however far the page scrolls; backed, so the rows passing under it stay out of its title. -->
        <div
          bind:this={head}
          class="sticky top-3 z-10 rounded-lg bg-background/60"
          style:transform="translateY({headLift}px)"
        >
          <DrillHeader
            {back}
            title={group.label}
            onback={() => onnavigate(null)}
            class="glass-ambient rounded-lg border elevation-1"
          />
        </div>
        <!-- Its sections are cards of their own: the `drill-card` utility. -->
        <div bind:this={level} data-drill="level" class="flex min-w-0 flex-col">
          {@render page(group)}
        </div>
      </section>
    {/if}
  </div>
{/if}

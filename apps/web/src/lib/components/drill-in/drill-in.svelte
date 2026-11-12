<!--
  ADR 21's drill-in for Controls and Settings: a root list of groups, each row summarising its values.
  A row slides its page in from the right while the root shifts left and dims; an edge-swipe follows
  the finger back. From 1024 px the two levels sit side by side instead and nothing slides. The open
  group is the caller's hash route: `open` follows it, `onnavigate` asks to change it.
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
</script>

<script lang="ts">
  import { untrack, type Snippet } from "svelte";
  import { MediaQuery } from "svelte/reactivity";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import * as Item from "../ui/item/index.js";
  import { Button } from "../ui/button/index.js";
  import { spring, tween, VelocityTracker } from "../../animate.ts";
  import { haptics } from "../../haptics.ts";
  import { settle, slideMs, still } from "./drill.ts";
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
    heading?: Snippet;
    page: Snippet<[DrillGroup]>;
  } = $props();

  // Two panes from 1024 px (ADR 21).
  const split = new MediaQuery("(min-width: 1024px)");

  // The page on screen: it stays while it slides out after the route has left it.
  // svelte-ignore state_referenced_locally
  let shown = $state<string | null>(open);

  // 0 on the root, 1 on the page.
  // svelte-ignore state_referenced_locally
  let p = $state(open === null ? 0 : 1);

  // svelte-ignore state_referenced_locally
  let target: 0 | 1 = open === null ? 0 : 1;

  let cancel: (() => void) | undefined;
  let box: HTMLDivElement | undefined = $state();

  const group = $derived(groups.find((g) => g.id === shown));
  const pane = $derived(groups.find((g) => g.id === open) ?? groups[0]);

  // The route moved (a row, back, the back button): slide to it from wherever the slide is.
  $effect(() => {
    const want = open === null ? 0 : 1;

    if (open !== null) shown = open;

    if (want === target) return;

    // Two panes have nothing to slide.
    if (split.current) {
      target = want;
      p = want;

      if (want === 0) shown = null;

      return;
    }

    untrack(() => {
      slide(want);
    });
  });

  function slide(to: 0 | 1, velocity?: number): void {
    cancel?.();
    target = to;

    const done = () => {
      cancel = undefined;

      if (to === 0) shown = null;

      haptics.soft();
    };

    if (still()) {
      p = to;
      done();

      return;
    }

    const set = (value: number) => {
      p = value;
    };

    // A release keeps its velocity; anything else runs the ease-in-out from where it is.
    cancel =
      velocity === undefined
        ? tween(p, to, slideMs(p, to), set, done)
        : spring(p, to, set, { stiffness: 300, damping: 32, velocity }, done);
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

{#if split.current}
  <DrillPanes {groups} {pane} onpick={pick} {label} {heading} {page} />
{:else}
  <div class="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6">
    {@render heading?.()}
    <!-- One divided surface; the levels slide inside it. -->
    <div
      bind:this={box}
      data-drill="box"
      class="glass-ambient relative grid touch-pan-y overflow-hidden rounded-lg border border-border/60 elevation-2"
      onpointerdown={down}
      onpointermove={move}
      onpointerup={up}
      onpointercancel={up}
      role="presentation"
    >
      <section
        class="col-start-1 row-start-1 flex flex-col"
        style:transform="translateX({-30 * p}%)"
        style:opacity={1 - 0.6 * p}
        aria-hidden={p > 0.5}
        inert={p > 0.5}
      >
        <Item.Group class="gap-0 divide-y divide-border/60">
          {#each groups as g (g.id)}
            <DrillRow group={g} onclick={() => onnavigate(g.id)} />
          {/each}
        </Item.Group>
      </section>
      <!-- Dim over the root. -->
      <div
        class="pointer-events-none col-start-1 row-start-1 bg-black"
        style:opacity={p * 0.28}
      ></div>

      {#if group}
        <section
          data-drill="page"
          class="glass-ambient col-start-1 row-start-1 flex flex-col shadow-[-12px_0_32px_-12px_rgb(0_0_0/0.35)]"
          style:transform="translateX({(1 - p) * 100}%)"
          aria-label={group.label}
        >
          <div class="relative flex items-center border-b border-border/60 p-1.5">
            <Button variant="ghost" size="sm" onclick={() => onnavigate(null)} class="text-brand">
              <ChevronLeft data-icon="inline-start" />
              {back}
            </Button>
            <h2 class="absolute left-1/2 -translate-x-1/2 text-[15px] font-semibold">
              {group.label}
            </h2>
          </div>
          {@render page(group)}
        </section>
      {/if}
    </div>
  </div>
{/if}

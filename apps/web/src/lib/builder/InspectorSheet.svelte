<!--
  The inspector on a portrait tablet (ADR 20): a glass sheet over the canvas's lower edge that is
  pulled up to edit and down to look. The finger moves it 1:1, then a spring takes over at the
  release velocity and settles at the nearer snap (ADR 21). A tap on the handle toggles it.
-->
<script lang="ts" module>
  /** What stays in view pulled down: the handle and the inspector's header. */
  export const PEEK = 76;

  /** The inspector's header in that peek. */
  const HEADER = 48;
</script>

<script lang="ts">
  import { Pressable } from "../components/ui/pressable/index.js";
  import type { Snippet } from "svelte";
  import { spring, VelocityTracker } from "../animate.ts";
  import { haptics } from "../haptics.ts";
  import { m } from "../paraglide/messages.js";

  let {
    expanded = $bindable(false),
    bar,
    children,
  }: {
    expanded?: boolean;
    /** Shown in the peek in place of the inspector's header, and at hand while pulled down. */
    bar?: Snippet | undefined;
    children: Snippet;
  } = $props();

  const uid = $props.id();

  let height = $state(0);

  let handle = $state<HTMLButtonElement | null>(null);

  /** Pixels below the pulled-up place while the finger or the spring holds it; else at rest. */
  let held = $state<number | null>(null);

  /** The bar's height: the peek grows with a bar taller than the header it stands for. */
  let tall = $state(0);

  const peek = $derived(bar === undefined ? PEEK : Math.max(PEEK, PEEK - HEADER + tall));
  const rest = $derived(Math.max(0, height - peek));
  const y = $derived(held ?? (expanded ? 0 : rest));

  const tracker = new VelocityTracker();
  let drag: { id: number; y0: number; from: number; moved: boolean } | undefined;
  let cancel: (() => void) | undefined;

  // A drag ends in a click too; it must not toggle the sheet back.
  let dragged = false;

  function down(event: PointerEvent): void {
    cancel?.();
    drag = { id: event.pointerId, y0: event.clientY, from: y, moved: false };
    tracker.reset();
  }

  function move(event: PointerEvent): void {
    if (drag?.id !== event.pointerId) return;

    const dy = event.clientY - drag.y0;

    if (!drag.moved && Math.abs(dy) < 6) return;

    if (!drag.moved) handle?.setPointerCapture(event.pointerId);

    drag.moved = true;
    held = Math.max(0, Math.min(rest, drag.from + dy));
    tracker.push(held);
  }

  function up(event: PointerEvent): void {
    if (drag?.id !== event.pointerId) return;

    const { moved } = drag;

    drag = undefined;

    if (!moved || held === null) return;

    dragged = true;

    const velocity = tracker.velocity();
    const open = velocity < -300 || (velocity < 300 && held < rest / 2);

    expanded = open;
    cancel = spring(
      held,
      open ? 0 : rest,
      (value) => {
        held = value;
      },
      { stiffness: 380, damping: 36, velocity, precision: 0.5 },
      () => {
        held = null;
        haptics.soft();
      },
    );
  }
</script>

<!-- A second layer of card behind the glass: its rows are read over a busy scene. -->
<section
  id="{uid}-sheet"
  aria-label={m.builder_edit()}
  bind:clientHeight={height}
  class={[
    "glass-ambient absolute inset-x-0 bottom-0 z-10 flex h-[min(78%,760px)] before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:bg-card/60 flex-col overflow-hidden rounded-t-lg border border-b-0 border-border/60 elevation-4",
    held === null && "transition-transform duration-(--motion-move) ease-(--motion-ease-in-out)",
  ]}
  style:transform="translateY({y}px)"
>
  <Pressable
    bind:ref={handle}
    type="button"
    class="flex h-7 shrink-0 touch-none items-center justify-center"
    aria-label={m.builder_edit()}
    aria-expanded={expanded}
    aria-controls="{uid}-sheet"
    onclick={() => {
      if (dragged) {
        dragged = false;

        return;
      }

      expanded = !expanded;
      haptics.soft();
    }}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
  >
    <span class="h-1.5 w-10 rounded-sm bg-foreground/20"></span>
  </Pressable>
  {#if bar}
    <div bind:clientHeight={tall} class="shrink-0">{@render bar()}</div>
  {/if}
  <div class="min-h-0 flex-1" inert={!expanded}>
    {@render children()}
  </div>
</section>

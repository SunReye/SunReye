<!--
  The inspector on a portrait tablet (ADR 20): a sheet over the canvas's lower edge that is
  pulled up to edit and down to look. The finger moves it 1:1, then a spring takes over at the
  release velocity and settles at the nearer snap (ADR 21). A tap on the handle toggles it.
-->
<script lang="ts" module>
  /** What stays in view pulled down: the handle and the inspector's header. */
  export const PEEK = 76;
</script>

<script lang="ts">
  import { Pressable } from "@sunreye/ui/pressable";
  import type { Snippet } from "svelte";
  import { spring, VelocityTracker } from "../animate.ts";
  import { haptics } from "@sunreye/ui/haptics";
  import { SPRINGS } from "../motion/values.ts";
  import { m } from "../paraglide/messages.js";

  let {
    expanded = $bindable(false),
    children,
  }: {
    expanded?: boolean;
    children: Snippet;
  } = $props();

  const uid = $props.id();

  let height = $state(0);

  let handle = $state<HTMLButtonElement | null>(null);

  /** Pixels below the pulled-up place while the finger or the spring holds it; else at rest. */
  let held = $state<number | null>(null);

  const rest = $derived(Math.max(0, height - PEEK));
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
      { ...SPRINGS.inspector, velocity, precision: 0.5 },
      () => {
        held = null;
        haptics.soft();
      },
    );
  }
</script>

<!-- Over the 3D canvas: the canvas chip's card, nearly opaque and without blur (ADR 21). -->
<section
  id="{uid}-sheet"
  aria-label={m.builder_edit()}
  bind:clientHeight={height}
  class={[
    "canvas-chip absolute inset-x-0 bottom-0 z-10 flex h-[min(78%,760px)] flex-col overflow-hidden rounded-t-lg border border-b-0 border-border/60 elevation-4",
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
  <div class="min-h-0 flex-1" inert={!expanded}>
    {@render children()}
  </div>
</section>

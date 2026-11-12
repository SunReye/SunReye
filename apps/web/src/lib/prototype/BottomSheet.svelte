<!--
  PROTOTYPE: the registry's bottom Sheet, made draggable. The finger moves it 1:1 through the CSS
  `translate` property (the Sheet's own enter/exit keyframes use `transform`, so both compose), then a
  spring takes over at the release velocity: back to open, or the Sheet closes from where it is.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import * as Sheet from "#lib/components/ui/sheet/index.js";
  import { spring, VelocityTracker } from "./animate";
  import { haptics } from "./haptics";

  let {
    open = $bindable(false),
    label,
    children,
    class: className = "",
  }: { open?: boolean; label: string; children: Snippet; class?: string } = $props();

  let sheet: HTMLElement | null = $state(null);
  let y = $state(0);
  let cancel: (() => void) | undefined;

  const tracker = new VelocityTracker();
  let pointer: number | undefined;
  let startY = 0;
  let startOffset = 0;
  let dragging = false;

  function down(e: PointerEvent): void {
    if ((e.target as Element).closest("[data-no-drag]")) return;
    pointer = e.pointerId;
    startY = e.clientY;
    startOffset = y;
    dragging = false;
    tracker.reset();
  }

  function move(e: PointerEvent): void {
    if (e.pointerId !== pointer) return;
    const dy = e.clientY - startY;
    if (!dragging) {
      if (Math.abs(dy) < 6) return;
      dragging = true;
      cancel?.();
      sheet?.setPointerCapture(e.pointerId);
    }
    const raw = startOffset + dy;
    y = raw < 0 ? -Math.sqrt(-raw) * 3 : raw;
    tracker.push(y);
  }

  function up(e: PointerEvent): void {
    if (e.pointerId !== pointer) return;
    pointer = undefined;
    if (!dragging) return;
    dragging = false;
    const v = tracker.velocity();
    const h = sheet?.offsetHeight ?? 600;
    if (v > 700 || (y > h * 0.35 && v > -300)) {
      open = false;
    } else {
      cancel?.();
      cancel = spring(y, 0, (x) => (y = x), { stiffness: 380, damping: 36, velocity: v, precision: 0.5 }, () => haptics.soft());
    }
  }
</script>

<Sheet.Root
  bind:open={() => open, (v) => {
    open = v;
    if (v) y = 0;
  }}
>
  <Sheet.Content
    bind:ref={sheet}
    side="bottom"
    showCloseButton={false}
    tabindex={-1}
    onOpenAutoFocus={(e) => {
      // Focus the sheet, not its first control: opening should not paint a focus ring.
      e.preventDefault();
      sheet?.focus();
    }}
    class="glass-ambient mx-auto max-h-[90dvh] max-w-xl touch-none gap-0 outline-none pb-[max(1rem,env(safe-area-inset-bottom))] {className}"
    style="translate: 0 {y}px"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
  >
    <Sheet.Title class="sr-only">{label}</Sheet.Title>
    <div class="flex justify-center pt-2.5 pb-1" aria-hidden="true">
      <span class="h-1.5 w-10 rounded-sm bg-foreground/20"></span>
    </div>
    {@render children()}
  </Sheet.Content>
</Sheet.Root>

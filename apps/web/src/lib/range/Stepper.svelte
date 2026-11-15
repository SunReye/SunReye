<!-- The range's label between its arrows; a swipe on it steps too, and the label rolls the way it went. -->
<script lang="ts">
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import { Button } from "#lib/components/ui/button/index.js";
  import { haptics } from "../haptics.ts";
  import { m } from "../paraglide/messages.js";
  import Pager, { type Travel } from "./Pager.svelte";
  import { swipe } from "./swipe.ts";

  let {
    label,
    dir,
    canPrev,
    canNext,
    onstep,
  }: {
    label: string;
    dir: -1 | 0 | 1 | undefined;
    canPrev: boolean;
    canNext: boolean;
    onstep: (dir: -1 | 1) => void;
  } = $props();

  let went: -1 | 0 | 1 = 0;

  function stepBy(to: -1 | 1): void {
    if (to < 0 ? !canPrev : !canNext) return;
    haptics.selection();
    went = to;
    onstep(to);
  }

  function roll(): Travel {
    const way = dir ?? went;
    went = 0;

    return { kind: "shift", dir: way };
  }
</script>

<div class="flex items-center justify-between gap-1" {@attach swipe(stepBy)}>
  <Button
    variant="ghost"
    size="icon-sm"
    class="pointer-coarse:size-10"
    aria-label={m.range_earlier()}
    disabled={!canPrev}
    onclick={() => stepBy(-1)}><ChevronLeft /></Button
  >
  <div
    class="min-w-[92px] text-center text-xs font-medium whitespace-nowrap tabular-nums"
    aria-live="polite"
  >
    <Pager id={label} data={label} travel={roll} after={60}>
      {#snippet children(text)}{text}{/snippet}
    </Pager>
  </div>
  <Button
    variant="ghost"
    size="icon-sm"
    class="pointer-coarse:size-10"
    aria-label={m.range_later()}
    disabled={!canNext}
    onclick={() => stepBy(1)}><ChevronRight /></Button
  >
</div>

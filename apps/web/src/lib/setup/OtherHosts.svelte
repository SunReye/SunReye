<!-- Hosts that answer but match no profile: folded away under one row, as a network may hold many. -->
<script lang="ts">
  import { Pressable } from "../components/ui/pressable/index.js";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import type { Snippet } from "svelte";
  import { haptics } from "../haptics.ts";
  import { m } from "../paraglide/messages.js";

  let { count, children }: { count: number; children: Snippet } = $props();

  const id = $props.id();

  let open = $state(false);
</script>

<section class="flex flex-col border-t border-border/60">
  <Pressable
    feedback
    aria-expanded={open}
    aria-controls={id}
    class="flex w-full items-center gap-3 px-4 py-3 text-left"
    onclick={() => {
      open = !open;
      haptics.selection();
    }}
  >
    <span class="flex min-w-0 flex-col">
      <span class="text-[15px] font-medium">
        {m.devices_others()} <span class="text-muted-foreground tabular-nums">{count}</span>
      </span>
      <span class="text-xs text-muted-foreground">{m.devices_others_hint()}</span>
    </span>
    <ChevronDown
      class={[
        "ml-auto size-4 shrink-0 text-muted-foreground transition-transform duration-(--motion-base)",
        open && "rotate-180",
      ]}
    />
  </Pressable>
  {#if open}
    <ul {id} class="divide-y divide-border/60 border-t border-border/60">
      {@render children()}
    </ul>
  {/if}
</section>

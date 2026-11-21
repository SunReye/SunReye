<!-- Hosts that answer but match no profile: folded away under one row, as a network may hold many. -->
<script lang="ts">
  import * as Collapsible from "#lib/components/ui/collapsible/index.js";
  import { FEEDBACK } from "#lib/components/ui/pressable/index.js";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import type { Snippet } from "svelte";
  import { m } from "../paraglide/messages.js";

  let { count, children }: { count: number; children: Snippet } = $props();

  let open = $state(false);
</script>

<Collapsible.Root bind:open class="flex flex-col border-t border-border/60">
  {#snippet child({ props })}
    <section {...props}>
      <Collapsible.Trigger
        class={[
          "flex w-full items-center gap-3 px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          FEEDBACK,
        ]}
      >
        <span class="flex min-w-0 flex-col">
          <span class="text-[15px] font-medium">
            {m.devices_others()} <span class="text-muted-foreground tabular-nums">{count}</span>
          </span>
          <span class="text-xs text-muted-foreground">{m.devices_others_hint()}</span>
        </span>
        <ChevronDown class="ml-auto size-4 shrink-0 text-muted-foreground" />
      </Collapsible.Trigger>
      <!-- A network may hold many: their rows are made once the fold opens. -->
      <Collapsible.Content>
        {#if open}
          <ul class="divide-y divide-border/60 border-t border-border/60">
            {@render children()}
          </ul>
        {/if}
      </Collapsible.Content>
    </section>
  {/snippet}
</Collapsible.Root>

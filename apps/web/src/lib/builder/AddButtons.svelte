<!-- A group's add buttons: each adds its object and opens it. -->
<script lang="ts">
  import Plus from "@lucide/svelte/icons/plus";
  import { Button } from "#lib/components/ui/button/index.js";
  import type { Addition } from "./additions.ts";
  import type { Level } from "./levels.ts";
  import type { Draft } from "./modules.ts";

  let {
    adds,
    onchange,
    onlevel,
  }: {
    adds: readonly Addition[];
    onchange: (draft: Draft) => void;
    onlevel: (level: Level) => void;
  } = $props();
</script>

{#if adds.length > 0}
  <div class="flex flex-col gap-2 border-t border-border/60 p-3">
    {#each adds as add (add.label)}
      <Button
        variant="outline"
        class="justify-start"
        onclick={() => {
          onchange(add.draft);
          onlevel(add.level);
        }}
      >
        <Plus data-icon="inline-start" />
        {add.label}
      </Button>
    {/each}
  </div>
{/if}

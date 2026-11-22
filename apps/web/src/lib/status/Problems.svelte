<script lang="ts">
  import Section from "../components/section.svelte";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import type { Core } from "../api/core";
  import * as Item from "#lib/components/ui/item/index.js";
  import LoadingRows from "../components/loading-rows.svelte";
  import { problemText } from "../i18n/problems";
  import { m } from "../paraglide/messages.js";
  import Refusal from "../setup/Refusal.svelte";

  let { answer }: { answer: ReturnType<Core["problems"]> } = $props();
</script>

<Section card title={m.status_problems()}>
  {#await answer}
    <LoadingRows rows={1} />
  {:then got}
    {#if "problem" in got}
      <div class="p-4"><Refusal refused={got} /></div>
    {:else if got.length === 0}
      <p class="flex items-center gap-2.5 px-4 py-3.5 text-sm text-muted-foreground">
        <CircleCheck class="size-4 shrink-0" />{m.status_no_problems()}
      </p>
    {:else}
      <!-- Every condition the core reports degrades it, so each takes ADR 21's error treatment. -->
      <Item.Group class="gap-0 divide-y divide-border/60">
        {#each got as condition (condition.code)}
          <Item.Root class="rounded-none border-0" role="listitem">
            <Item.Media>
              <CircleAlert
                role="img"
                aria-label={m.status_error()}
                class="size-4 text-destructive"
              />
            </Item.Media>
            <Item.Content>
              <Item.Title class="text-[15px] font-normal">{problemText(condition.code)}</Item.Title>
            </Item.Content>
          </Item.Root>
        {/each}
      </Item.Group>
    {/if}
  {/await}
</Section>

<!-- Settings › Forecast & layout: the PV layout the forecast models lives in the builder (ADR 17, 20). -->
<script lang="ts">
  import DrillCard from "../components/drill-in/drill-card.svelte";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import * as Item from "#lib/components/ui/item/index.js";
  import { FEEDBACK } from "#lib/components/ui/pressable/index.js";
  import { m } from "../paraglide/messages.js";
</script>

<DrillCard>
  <Item.Root class="rounded-none border-0">
    {#snippet child({ props })}
      <a {...props} href="#/builder" class={[props.class, FEEDBACK]}>
        <Item.Content>
          <Item.Title class="text-[15px] font-normal">{m.settings_builder()}</Item.Title>
          <Item.Description>{m.settings_builder_hint()}</Item.Description>
        </Item.Content>
        <Item.Actions><ChevronRight class="size-4 text-muted-foreground" /></Item.Actions>
      </a>
    {/snippet}
  </Item.Root>
</DrillCard>

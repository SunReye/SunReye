<!-- Settings › Forecast & layout: the PV layout the forecast models lives in the builder (ADR 17, 20). -->
<script lang="ts">
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import * as Item from "#lib/components/ui/item/index.js";
  import { m } from "../paraglide/messages.js";
</script>

<div class="drill-card">
  <Item.Root class="rounded-none border-0">
    {#snippet child({ props })}
      <a {...props} href="#/builder" class={[props.class, "hover:bg-muted/60"]}>
        <Item.Content>
          <Item.Title class="text-[15px] font-normal">{m.settings_builder()}</Item.Title>
          <Item.Description>{m.settings_builder_hint()}</Item.Description>
        </Item.Content>
        <Item.Actions><ChevronRight class="size-4 text-muted-foreground" /></Item.Actions>
      </a>
    {/snippet}
  </Item.Root>
</div>

<!-- The bar's More sheet: the screens the bar has no room for, a card of rows. -->
<script lang="ts">
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import { Badge } from "#lib/components/ui/badge/index.js";
  import * as Card from "#lib/components/ui/card/index.js";
  import * as Item from "#lib/components/ui/item/index.js";
  import { FEEDBACK } from "#lib/components/ui/pressable/index.js";
  import NavLink from "#lib/components/nav-link.svelte";
  import { m } from "../paraglide/messages.js";
  import { href, type NavItem } from "./nav.ts";

  let {
    items,
    current,
    onpick,
  }: {
    items: readonly NavItem[];
    /** The route id shown. */
    current: string | null;
    onpick: () => void;
  } = $props();
</script>

<Card.Root class="gap-0 py-0">
  <Item.Group class="gap-0 divide-y divide-border/60">
    {#each items as item (item.route)}
      <Item.Root class="rounded-none border-0">
        {#snippet child({ props })}
          <NavLink
            {...props}
            href={href(item.route)}
            current={current === item.route}
            onclick={onpick}
            class={[props["class"], "text-left", FEEDBACK]}
          >
            <Item.Media variant="icon"><item.icon /></Item.Media>
            <Item.Content><Item.Title class="text-[15px]">{item.label()}</Item.Title></Item.Content>
            <Item.Actions>
              {#if item.admin}<Badge variant="secondary">{m.nav_admin()}</Badge>{/if}
              <ChevronRight class="size-4 text-muted-foreground" />
            </Item.Actions>
          </NavLink>
        {/snippet}
      </Item.Root>
    {/each}
  </Item.Group>
</Card.Root>

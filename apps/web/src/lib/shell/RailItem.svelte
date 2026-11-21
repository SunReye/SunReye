<!-- One rail destination: a sidebar row, with a tooltip while the rail shows icons only. -->
<script lang="ts">
  import NavLink from "#lib/components/nav-link.svelte";
  import { Badge } from "#lib/components/ui/badge/index.js";
  import { sidebarMenuButtonVariants } from "#lib/components/ui/sidebar/sidebar-menu-button.svelte";
  import * as Tooltip from "#lib/components/ui/tooltip/index.js";
  import { cn } from "#lib/utils.js";
  import { m } from "../paraglide/messages.js";
  import { href, type NavItem } from "./nav.ts";

  let {
    item,
    active,
    expanded,
    onnavigate,
  }: { item: NavItem; active: boolean; expanded: boolean; onnavigate: () => void } = $props();
</script>

<Tooltip.Root disabled={expanded}>
  <Tooltip.Trigger>
    {#snippet child({ props })}
      <NavLink
        {...props}
        href={href(item.route)}
        data-sidebar="menu-button"
        data-active={active || undefined}
        current={active}
        onclick={onnavigate}
        class={cn(
          sidebarMenuButtonVariants({ size: "default" }),
          "pointer-events-auto h-8",
          expanded ? "w-full" : "w-8",
          active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
        )}
      >
        <item.icon class={active ? "text-brand" : ""} />
        <span class="label">{item.label()}</span>
        {#if item.admin}<Badge variant="secondary" class="label ml-auto">{m.nav_admin()}</Badge
          >{/if}
      </NavLink>
    {/snippet}
  </Tooltip.Trigger>
  <Tooltip.Content side="right" sideOffset={14}>{item.label()}</Tooltip.Content>
</Tooltip.Root>

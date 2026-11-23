<script lang="ts">
  import PanelLeftIcon from "@lucide/svelte/icons/panel-left";
  import { Button } from "@sunreye/ui/button";
  import { cn } from "@sunreye/ui/utils";
  import { useSidebar } from "./context.svelte.js";
  import type { ComponentProps } from "svelte";

  let {
    ref = $bindable(null),
    class: className,
    onclick,
    ...restProps
  }: ComponentProps<typeof Button> & {
    onclick?: (e: MouseEvent) => void;
  } = $props();

  const sidebar = useSidebar();
</script>

<Button
  bind:ref
  data-sidebar="trigger"
  data-slot="sidebar-trigger"
  variant="ghost"
  size="icon-sm"
  class={cn(className)}
  type="button"
  onclick={(e) => {
    onclick?.(e);
    sidebar.toggle();
  }}
  {...restProps}
>
  <PanelLeftIcon class="cn-rtl-flip" />
  <span class="sr-only">Toggle Sidebar</span>
</Button>

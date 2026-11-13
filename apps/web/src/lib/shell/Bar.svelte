<!--
  The phone's floating bottom bar (ADR 21): four screens and More, which opens a draggable sheet
  with the rest. Sticky: it never hides on scroll.
-->
<script lang="ts">
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Ellipsis from "@lucide/svelte/icons/ellipsis";
  import { Badge } from "#lib/components/ui/badge/index.js";
  import * as Item from "#lib/components/ui/item/index.js";
  import * as ToggleGroup from "#lib/components/ui/toggle-group/index.js";
  import BottomSheet from "#lib/components/bottom-sheet.svelte";
  import { cn } from "#lib/utils.js";
  import { haptics } from "../haptics.ts";
  import { m } from "../paraglide/messages.js";
  import { BAR, MORE, href, type NavItem } from "./nav.ts";

  let {
    current,
    admin,
    goto,
  }: {
    /** The route id shown. */
    current: string | null;
    /** Whether Controls is listed. */
    admin: boolean;
    /**
     * SvelteKit's `goto`. A bare `location.hash` write reads to the hash router as an edit in the
     * address bar, which it answers with a full reload: a white frame between screens.
     */
    goto: (url: string) => Promise<void>;
  } = $props();

  const MORE_ID = "more";

  let moreOpen = $state(false);

  const items: readonly NavItem[] = [...BAR, { route: MORE_ID, label: m.nav_more, icon: Ellipsis }];

  const more = $derived(MORE.filter((item) => admin || item.admin === undefined));

  const active = $derived(
    current !== null && BAR.some((item) => item.route === current) ? current : MORE_ID,
  );

  function go(route: string): void {
    if (route !== current) haptics.selection();

    moreOpen = false;
  }

  // A tap on the pressed item clears a single group's value; it still means that item.
  function pick(value: string): void {
    const route = value === "" ? active : value;

    if (route === MORE_ID) {
      moreOpen = true;
      haptics.soft();
    } else {
      go(route);

      if (route !== current) void goto(href(route));
    }
  }
</script>

<nav
  aria-label={m.nav_main()}
  class="glass-sidebar glass-ambient fixed inset-x-2 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-40 rounded-lg p-1 ring-1 ring-sidebar-border elevation-3 ring-inset"
>
  <ToggleGroup.Root
    type="single"
    spacing={0.5}
    class="grid w-full grid-cols-5"
    bind:value={() => active, pick}
  >
    {#each items as item (item.route)}
      <ToggleGroup.Item
        value={item.route}
        aria-label={item.label()}
        class="h-14 w-full min-w-0 flex-col gap-1.5 px-0 text-muted-foreground data-[state=on]:text-foreground"
      >
        <item.icon class={cn("size-5", active === item.route && "text-brand")} />
        <!-- Truncated as a last resort; every locale's labels fit 320 px (tested). -->
        <span class="max-w-full truncate text-[11px] leading-none font-medium tracking-tight"
          >{(item.short ?? item.label)()}</span
        >
      </ToggleGroup.Item>
    {/each}
  </ToggleGroup.Root>
</nav>

<BottomSheet bind:open={moreOpen} label={m.nav_more()}>
  <div class="flex flex-col gap-3 px-4 pt-1 pb-2">
    <h2 class="px-1 text-lg font-semibold">{m.nav_more()}</h2>
    <Item.Group
      class="glass-ambient gap-0 divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60"
    >
      {#each more as item (item.route)}
        <Item.Root class="rounded-none border-0">
          {#snippet child({ props })}
            <a
              {...props}
              href={href(item.route)}
              aria-current={current === item.route ? "page" : undefined}
              onclick={() => {
                go(item.route);
              }}
              class={cn(props["class"] as string, "text-left active:bg-muted")}
            >
              <Item.Media variant="icon"><item.icon /></Item.Media>
              <Item.Content
                ><Item.Title class="text-[15px]">{item.label()}</Item.Title></Item.Content
              >
              <Item.Actions>
                {#if item.admin}<Badge variant="secondary">{m.nav_admin()}</Badge>{/if}
                <ChevronRight class="size-4 text-muted-foreground" />
              </Item.Actions>
            </a>
          {/snippet}
        </Item.Root>
      {/each}
    </Item.Group>
  </div>
</BottomSheet>

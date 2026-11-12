<!--
  PROTOTYPE: shell by input and width (ADR 21). Mouse: floating icon rail that expands over the
  content. Touch ≥768 px: the same rail, opened from the logo. Touch <768 px: floating bottom bar with More.
  An opened rail never pushes the page: hovered, pinned or opened by touch, it floats above it.
  The registry's Sidebar animates its width and pushes the content, which ADR 21 rules out, so the
  rail keeps its own transform-only frame but is built from the sidebar's parts: the floating
  sidebar's surface, `sidebarMenuButtonVariants` rows and the Tooltip for collapsed icons.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import Pin from "@lucide/svelte/icons/pin";
  import PinOff from "@lucide/svelte/icons/pin-off";
  import Ellipsis from "@lucide/svelte/icons/ellipsis";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import { sidebarMenuButtonVariants } from "#lib/components/ui/sidebar/sidebar-menu-button.svelte";
  import * as Tooltip from "#lib/components/ui/tooltip/index.js";
  import * as ToggleGroup from "#lib/components/ui/toggle-group/index.js";
  import * as Item from "#lib/components/ui/item/index.js";
  import { Badge } from "#lib/components/ui/badge/index.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import { cn } from "#lib/utils.js";
  import { NAV, RAIL, BAR, MORE, type Screen } from "./nav";
  import { input } from "./input.svelte";
  import { haptics } from "./haptics";
  import BottomSheet from "./BottomSheet.svelte";
  import type { LiveSim } from "./sim.svelte";

  let {
    screen = "dashboard",
    onnavigate,
    sim,
    forceExpanded = false,
    children,
  }: { screen?: Screen; onnavigate: (id: Screen) => void; sim: LiveSim; forceExpanded?: boolean; children: Snippet } = $props();

  // The connection chip (ADR 21): quiet while live, loud when the stream stalls or drops.
  const stream = $derived(
    sim.status === "live"
      ? { dot: "bg-success text-success animate-pulse-dot motion-reduce:animate-none", text: `Live · vor ${sim.age} s`, loud: false }
      : sim.status === "loading"
        ? { dot: "bg-muted-foreground", text: "Verbinde …", loud: false }
        : sim.status === "stalled"
          ? { dot: "bg-warning", text: `Keine Daten seit ${sim.age} s`, loud: true }
          : { dot: "bg-destructive", text: "Verbindung getrennt", loud: true },
  );

  // The sidebar's own widths: 16rem open, 3rem as icons.
  const RAIL_W = 256;
  const ICON_W = 48;

  let hovered = $state(false);
  let focused = $state(false);
  let pinned = $state(typeof localStorage !== "undefined" && localStorage.getItem("proto.rail.pinned") === "1");
  // Touch: the rail opens from the logo and floats over the page; it starts as icons.
  let touchCollapsed = $state(true);
  let moreOpen = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const shell = $derived(input.shell);
  const expanded = $derived(
    forceExpanded || (shell === "rail" ? hovered || focused || pinned : shell === "rail-open" ? !touchCollapsed : false),
  );

  function enter(): void {
    clearTimeout(timer);
    hovered = true;
  }
  function leave(): void {
    clearTimeout(timer);
    timer = setTimeout(() => (hovered = false), 300);
  }

  function go(id: Screen): void {
    if (id !== screen) haptics.selection();
    moreOpen = false;
    touchCollapsed = true;
    onnavigate(id);
  }

  function togglePin(): void {
    pinned = !pinned;
    localStorage.setItem("proto.rail.pinned", pinned ? "1" : "0");
    haptics.soft();
  }

  const barActive = $derived(BAR.includes(screen) ? screen : "more");
  const row = (active: boolean) =>
    cn(sidebarMenuButtonVariants({ size: "default" }), "pointer-events-auto h-8", expanded ? "w-full" : "w-8", active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground");
</script>

{#snippet logo()}
  <!-- v3's mark: a flat sun in the brand blue. -->
  <span class="grid size-8 shrink-0 place-items-center text-primary">
    <svg viewBox="0 0 48 48" class="size-7" fill="none" aria-hidden="true">
      <g stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
        <line x1="24" y1="4" x2="24" y2="9.5" /><line x1="24" y1="38.5" x2="24" y2="44" />
        <line x1="4" y1="24" x2="9.5" y2="24" /><line x1="38.5" y1="24" x2="44" y2="24" />
        <line x1="10.1" y1="10.1" x2="14" y2="14" /><line x1="34" y1="34" x2="37.9" y2="37.9" />
        <line x1="37.9" y1="10.1" x2="34" y2="14" /><line x1="14" y1="34" x2="10.1" y2="37.9" />
      </g>
      <circle cx="24" cy="24" r="8" fill="currentColor" />
    </svg>
  </span>
{/snippet}

{#snippet railItem(id: Screen)}
  {@const item = NAV[id]}
  <Tooltip.Root disabled={expanded}>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <button
          {...props}
          type="button"
          data-sidebar="menu-button"
          data-active={screen === id || undefined}
          aria-current={screen === id ? "page" : undefined}
          onclick={() => go(id)}
          class={row(screen === id)}
        >
          <item.icon class={screen === id ? "text-brand" : ""} />
          <span class="label">{item.label}</span>
          {#if id === "controls"}<Badge variant="secondary" class="label ml-auto">Admin</Badge>{/if}
        </button>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content side="right" sideOffset={14}>{item.label}</Tooltip.Content>
  </Tooltip.Root>
{/snippet}

<!-- An opened rail always floats above the page (owner, 2026-11-12); on touch a tap outside closes it. -->
<svelte:document
  onpointerdown={(e) => {
    if (shell === "rail-open" && !touchCollapsed && !(e.target as Element).closest("nav.rail")) touchCollapsed = true;
  }}
/>

<Tooltip.Provider>
  {#if shell !== "bar"}
    {#if shell === "rail"}
      <div class="fixed inset-y-0 left-0 z-30 w-[84px]" onpointerenter={enter} onpointerleave={leave} aria-hidden="true"></div>
    {/if}
    <nav
      aria-label="Hauptnavigation"
      class="rail pointer-events-none fixed top-2 bottom-2 left-2 z-40 overflow-hidden rounded-lg text-sidebar-foreground"
      style:width="{RAIL_W}px"
      data-expanded={expanded}
      onpointerenter={shell === "rail" ? enter : undefined}
      onpointerleave={shell === "rail" ? leave : undefined}
      onfocusin={() => (focused = true)}
      onfocusout={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) focused = false;
      }}
    >
      <!-- The floating sidebar's surface; it slides, only transform animates. -->
      <div
        class="glass-sidebar glass-ambient pointer-events-auto absolute inset-0 rounded-lg ring-1 ring-sidebar-border elevation-2 ring-inset transition-transform duration-(--motion-move) ease-(--motion-ease-in-out)"
        style:transform="translateX({expanded ? 0 : -(RAIL_W - ICON_W)}px)"
      ></div>
      <div class="pointer-events-none absolute inset-0 rounded-lg shadow-[inset_1px_0_0_0_var(--sidebar-border)]"></div>

      <div class="relative flex h-full flex-col gap-2 p-2">
        <button
          type="button"
          class={cn(sidebarMenuButtonVariants({ size: "lg" }), "pointer-events-auto p-0!", expanded ? "w-full" : "w-8")}
          onclick={() => {
            if (shell === "rail-open") {
              touchCollapsed = !touchCollapsed;
              haptics.soft();
            } else go("dashboard");
          }}
          aria-label="SunReye"
        >
          {@render logo()}
          <span class="label flex min-w-0 flex-col leading-tight">
            <span class="text-sm font-semibold">SunReye</span>
            <span class="truncate text-xs text-muted-foreground" title={sim.plantName}>{sim.plantName}</span>
          </span>
        </button>

        <ul class="flex flex-col gap-1" data-sidebar="menu">
          {#each RAIL as id (id)}
            <li data-sidebar="menu-item">{@render railItem(id)}</li>
          {/each}
        </ul>

        <ul class="mt-auto flex flex-col gap-1" data-sidebar="menu">
          <li>{@render railItem("settings")}</li>
          <li class="flex h-8 items-center gap-2">
            <span class="grid size-8 shrink-0 place-items-center" title={stream.text} role="status" aria-label={stream.text}>
              <span class={["size-2 rounded-full", stream.dot]}></span>
            </span>
            <span class={["label truncate text-xs", stream.loud ? "font-medium text-foreground" : "text-muted-foreground"]}>{stream.text}</span>
            {#if shell === "rail"}
              <Button
                variant="ghost"
                size="icon-sm"
                onclick={togglePin}
                class="label pointer-events-auto ml-auto"
                aria-label={pinned ? "Lösen" : "Anheften"}
                aria-pressed={pinned}
              >
                {#if pinned}<PinOff />{:else}<Pin />{/if}
              </Button>
            {/if}
          </li>
        </ul>
      </div>
    </nav>
  {/if}

  <div
    class={["relative min-h-dvh", shell === "bar" ? "pb-[calc(84px+env(safe-area-inset-bottom))]" : ""]}
    style:padding-left="var(--shell-pad)"
    style:--shell-pad={shell === "bar" ? "0px" : `${ICON_W + 24}px`}
  >
    <!-- Away from the dashboard's own headline a stall still has to be seen: one strip in the flow, covering nothing. -->
    {#if stream.loud && screen !== "dashboard"}
      <div class="mx-auto mt-3 flex w-fit items-center gap-2 rounded-md border border-border/60 px-3 py-1.5 text-xs font-medium" role="status">
        <span class={["size-2 rounded-full", stream.dot]}></span>{stream.text}
      </div>
    {/if}
    {@render children()}
  </div>


  {#if shell === "bar"}
    <nav
      aria-label="Hauptnavigation"
      class="glass-sidebar glass-ambient fixed inset-x-2 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-40 rounded-lg p-1 ring-1 ring-sidebar-border elevation-3 ring-inset"
    >
      <ToggleGroup.Root
        type="single"
        spacing={1}
        class="grid w-full grid-cols-5"
        bind:value={() => barActive, (v: string) => {
          if (v === "more") {
            moreOpen = true;
            haptics.soft();
          } else if (v) go(v as Screen);
        }}
      >
        {#each [...BAR, "more" as const] as id (id)}
          {@const item = id === "more" ? { label: "Mehr", icon: Ellipsis } : NAV[id]}
          <ToggleGroup.Item value={id} aria-label={item.label} class="h-14 w-full min-w-0 flex-col gap-1.5 px-0 text-muted-foreground data-[state=on]:text-foreground">
            <item.icon class={["size-5", barActive === id && "text-brand"]} />
            <span class="text-[11px] leading-none font-medium">{item.label}</span>
          </ToggleGroup.Item>
        {/each}
      </ToggleGroup.Root>
    </nav>

    <BottomSheet bind:open={moreOpen} label="Mehr">
      <div class="flex flex-col gap-3 px-4 pt-1 pb-2">
        <h2 class="px-1 text-lg font-semibold">Mehr</h2>
        <Item.Group class="glass-ambient gap-0 divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60">
          {#each MORE as id (id)}
            {@const item = NAV[id]}
            <Item.Root class="rounded-none border-0">
              {#snippet child({ props })}
                <button {...props} type="button" onclick={() => go(id)} class={cn(props.class as string, "text-left active:bg-muted")}>
                  <Item.Media variant="icon"><item.icon /></Item.Media>
                  <Item.Content><Item.Title class="text-[15px]">{item.label}</Item.Title></Item.Content>
                  <Item.Actions>
                    {#if id === "controls"}<Badge variant="secondary">Admin</Badge>{/if}
                    <ChevronRight class="size-4 text-muted-foreground" />
                  </Item.Actions>
                </button>
              {/snippet}
            </Item.Root>
          {/each}
        </Item.Group>
      </div>
    </BottomSheet>
  {/if}
</Tooltip.Provider>

<style>
  .rail :global(.label) {
    opacity: 0;
    transform: translateX(-6px);
    pointer-events: none;
    transition:
      opacity 150ms var(--motion-ease),
      transform 150ms var(--motion-ease);
  }
  .rail[data-expanded="true"] :global(.label) {
    opacity: 1;
    transform: none;
    pointer-events: auto;
    transition:
      opacity 220ms var(--motion-ease) 60ms,
      transform 220ms var(--motion-ease) 60ms;
  }
</style>

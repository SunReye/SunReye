<!--
  The floating rail (ADR 21). Mouse: icons that expand over the content on hover or focus. Touch
  ≥ 768 px: the same rail, opened from the logo. An open rail never pushes the page, so it keeps its
  own transform-only frame built from the sidebar's parts: the floating sidebar's surface,
  `sidebarMenuButtonVariants` rows and the Tooltip for collapsed icons.
-->
<script lang="ts" module>
  // The sidebar's own widths: 16rem open, 3rem as icons.
  const RAIL_W = 256;
  const ICON_W = 48;

  /** The content's left inset: the icon rail and its margins, so expanding never moves it. */
  export const GUTTER = ICON_W + 24;
</script>

<script lang="ts">
  import Pin from "@lucide/svelte/icons/pin";
  import PinOff from "@lucide/svelte/icons/pin-off";
  import { Button } from "#lib/components/ui/button/index.js";
  import { sidebarMenuButtonVariants } from "#lib/components/ui/sidebar/sidebar-menu-button.svelte";
  import SunMark from "#lib/components/sun-mark.svelte";
  import { cn } from "#lib/utils.js";
  import { m } from "../paraglide/messages.js";
  import { DASHBOARD, RAIL, SETTINGS, href } from "./nav.ts";
  import RailItem from "./RailItem.svelte";

  let {
    touch,
    current,
    admin,
  }: {
    /** Touch at 768 px and wider: opened from the logo, not by hover. */
    touch: boolean;
    /** The route id shown. */
    current: string | null;
    /** Whether Controls is listed. */
    admin: boolean;
  } = $props();

  const PINNED = "sunreye.rail-pinned";

  let hovered = $state(false);
  let focused = $state(false);
  let pinned = $state(localStorage.getItem(PINNED) === "on");

  // Touch: the rail opens from the logo and floats over the page; it starts as icons.
  let touchCollapsed = $state(true);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const expanded = $derived(touch ? pinned || !touchCollapsed : hovered || focused || pinned);

  const items = $derived(RAIL.filter((item) => admin || item.admin === undefined));

  function enter(): void {
    clearTimeout(timer);
    hovered = true;
  }

  function leave(): void {
    clearTimeout(timer);
    timer = setTimeout(() => (hovered = false), 300);
  }

  function togglePin(): void {
    pinned = !pinned;
    localStorage.setItem(PINNED, pinned ? "on" : "off");
  }

  function collapse(): void {
    touchCollapsed = true;
  }
</script>

<!-- On touch a tap outside closes an unpinned rail. -->
<svelte:document
  onpointerdown={(e) => {
    if (touch && !(e.target as Element).closest("nav.rail")) collapse();
  }}
/>

{#if !touch}
  <!-- Hovering near the rail counts. -->
  <div
    class="fixed inset-y-0 left-0 z-30 w-[84px]"
    onpointerenter={enter}
    onpointerleave={leave}
    aria-hidden="true"
  ></div>
{/if}
<nav
  aria-label={m.nav_main()}
  class="rail pointer-events-none fixed top-2 bottom-2 left-2 z-40 overflow-hidden rounded-lg text-sidebar-foreground"
  style:width="{RAIL_W}px"
  data-expanded={expanded}
  onpointerenter={touch ? undefined : enter}
  onpointerleave={touch ? undefined : leave}
  onfocusin={() => (focused = true)}
  onfocusout={(e) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) focused = false;
  }}
>
  <!-- The floating sidebar's surface; it slides, only transform animates. -->
  <div
    data-rail-surface
    class="glass-sidebar glass-ambient pointer-events-auto absolute inset-0 rounded-lg ring-1 ring-sidebar-border elevation-2 ring-inset transition-transform duration-(--motion-move) ease-(--motion-ease-in-out)"
    style:transform="translateX({expanded ? 0 : -(RAIL_W - ICON_W)}px)"
  ></div>
  <div
    class="pointer-events-none absolute inset-0 rounded-lg shadow-[inset_1px_0_0_0_var(--sidebar-border)]"
  ></div>

  <div class="relative flex h-full flex-col gap-2 p-2">
    <a
      href={href(DASHBOARD.route)}
      class={cn(
        sidebarMenuButtonVariants({ size: "lg" }),
        "pointer-events-auto p-0!",
        expanded ? "w-full" : "w-8",
      )}
      onclick={(e) => {
        if (!touch) return;

        e.preventDefault();
        touchCollapsed = !touchCollapsed;
      }}
      aria-label="SunReye"
    >
      <span class="grid size-8 shrink-0 place-items-center">
        <SunMark class="size-7" />
      </span>
      <span class="label text-sm font-semibold">SunReye</span>
    </a>

    <ul class="flex flex-col gap-1" data-sidebar="menu">
      {#each items as item (item.route)}
        <li data-sidebar="menu-item">
          <RailItem {item} active={current === item.route} {expanded} onnavigate={collapse} />
        </li>
      {/each}
    </ul>

    <ul class="mt-auto flex flex-col gap-1" data-sidebar="menu">
      <li>
        <RailItem
          item={SETTINGS}
          active={current === SETTINGS.route}
          {expanded}
          onnavigate={collapse}
        />
      </li>
      <li class="flex h-8 items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onclick={togglePin}
          class="label pointer-events-auto ml-auto"
          aria-label={pinned ? m.nav_unpin() : m.nav_pin()}
          aria-pressed={pinned}
        >
          {#if pinned}<PinOff />{:else}<Pin />{/if}
        </Button>
      </li>
    </ul>
  </div>
</nav>

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

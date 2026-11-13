<!-- The hero's corner (ADR 21): the 3D/2D toggle, or for the admin without a scene the way to build one. -->
<script lang="ts">
  import Box from "@lucide/svelte/icons/box";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as ToggleGroup from "#lib/components/ui/toggle-group/index.js";
  import { haptics } from "../haptics.ts";
  import type { View } from "../live/dashboard.ts";
  import { m } from "../paraglide/messages.js";

  let {
    shows,
    toggles,
    build,
    onchoose,
  }: {
    shows: View;
    /** Whether both views can show. */
    toggles: boolean;
    /** Whether the builder is offered instead. */
    build: boolean;
    onchoose: (view: View) => void;
  } = $props();

  function set(next: string): void {
    if ((next !== "3d" && next !== "2d") || next === shows) return;

    haptics.selection();
    onchoose(next);
  }
</script>

{#if toggles}
  <ToggleGroup.Root
    type="single"
    size="sm"
    spacing={1}
    bind:value={() => shows, set}
    class="glass-ambient rounded-md p-0.5 ring-1 ring-border/60 elevation-1"
    aria-label={m.dash_view()}
  >
    <ToggleGroup.Item value="3d" class="px-3 text-xs">3D</ToggleGroup.Item>
    <ToggleGroup.Item value="2d" class="px-3 text-xs">2D</ToggleGroup.Item>
  </ToggleGroup.Root>
{:else if build}
  <Button
    variant="outline"
    size="sm"
    class="glass-ambient"
    href="#/builder"
  >
    <Box data-icon="inline-start" />
    {m.dash_build()}
  </Button>
{/if}

<!-- The orbit camera's preset views (ADR 20): one button on the canvas, its menu closed until asked for. -->
<script lang="ts">
  import Rotate3d from "@lucide/svelte/icons/rotate-3d";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as DropdownMenu from "#lib/components/ui/dropdown-menu/index.js";
  import { m } from "../paraglide/messages.js";
  import { presets, type Preset } from "./camera.ts";

  let { onpick }: { onpick: (preset: Preset) => void } = $props();

  const labels: Readonly<Record<Preset, () => string>> = {
    north: m.view_north,
    east: m.view_east,
    south: m.view_south,
    west: m.view_west,
    top: m.view_top,
    isometric: m.view_isometric,
  };
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        variant="ghost"
        aria-label={m.builder_views()}
        class="canvas-chip size-11 ring-1 ring-border/60 elevation-1"
      >
        <Rotate3d />
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end" class="w-44">
    {#each presets as preset (preset)}
      <DropdownMenu.Item
        class="min-h-10"
        onSelect={() => {
          onpick(preset);
        }}>{labels[preset]()}</DropdownMenu.Item
      >
    {/each}
  </DropdownMenu.Content>
</DropdownMenu.Root>

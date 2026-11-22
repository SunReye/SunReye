<!-- The hero's corner (ADR 21): the 3D/2D toggle, or for the admin without a scene the way to build one. -->
<script lang="ts">
  import Box from "@lucide/svelte/icons/box";
  import { Button } from "#lib/components/ui/button/index.js";
  import Segmented from "../components/segmented.svelte";
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

  const VIEWS = [
    ["3d", "3D"],
    ["2d", "2D"],
  ] as const satisfies readonly (readonly [View, string])[];
</script>

{#if toggles}
  <Segmented options={VIEWS} value={shows} label={m.dash_view()} canvas onchange={onchoose} />
{:else if build}
  <Button variant="outline" size="sm" class="canvas-chip" href="#/builder">
    <Box data-icon="inline-start" />
    {m.dash_build()}
  </Button>
{/if}

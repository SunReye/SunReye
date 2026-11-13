<!-- The hero's 3D layer (ADR 20 Loading): the studio stand-in until the scene fades in over it. -->
<script lang="ts">
  import type { Core } from "../api/core.ts";
  import type { SceneLayout } from "../live/dashboard.ts";
  import Scene3d from "../live/Scene3d.svelte";
  import type { SceneLoad } from "./scene-load.svelte.ts";
  import SceneStandIn from "./SceneStandIn.svelte";

  let {
    core,
    layout,
    load,
    locked,
    onselect,
  }: {
    core: Core;
    layout: SceneLayout;
    /** The camera stays put (ADR 20). */
    locked: boolean;
    load: SceneLoad;
    onselect: (id: string) => void;
  } = $props();
</script>

{#if load.under === "standin"}
  <SceneStandIn slow={load.slow && load.stage === "loading"} />
{/if}
{#if load.mounted}
  <div class="absolute inset-0">
    <Scene3d
      {core}
      {layout}
      {locked}
      {onselect}
      onready={() => {
        load.ready();
      }}
      onerror={(reason) => {
        load.fail(reason);
      }}
    />
  </div>
{/if}

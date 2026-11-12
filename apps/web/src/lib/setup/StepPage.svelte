<!-- One setup step's page inside the drill-in. -->
<script lang="ts">
  import type { Core, Device } from "../api/core.ts";
  import DevicesStep from "./DevicesStep.svelte";
  import PasswordStep from "./PasswordStep.svelte";
  import PlantStep from "./PlantStep.svelte";
  import type { Step } from "./steps.ts";
  import TopologyStep from "./TopologyStep.svelte";

  let {
    core,
    step,
    devices,
    ondone,
  }: {
    core: Core;
    step: Step;
    /** The devices the devices step added, for the topology. */
    devices: readonly Device[];
    ondone: (added?: readonly Device[]) => void;
  } = $props();
</script>

{#if step === "password"}
  <PasswordStep {core} ondone={() => ondone()} />
{:else if step === "plant"}
  <PlantStep {core} ondone={() => ondone()} />
{:else if step === "devices"}
  <DevicesStep {core} {ondone} />
{:else if step === "topology"}
  <TopologyStep {core} {devices} ondone={() => ondone()} />
{/if}

<script lang="ts">
  import type { Core, Device } from "../api/core.ts";
  import LocaleSwitch from "../LocaleSwitch.svelte";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";
  import DevicesStep from "./DevicesStep.svelte";
  import LayoutStep from "./LayoutStep.svelte";
  import PasswordStep from "./PasswordStep.svelte";
  import PlantStep from "./PlantStep.svelte";
  import TopologyStep from "./TopologyStep.svelte";

  let {
    core,
    signedIn,
    onfinish,
  }: {
    core: Core;
    /** Signed in already, as under Home Assistant ingress: no password to set. */
    signedIn: boolean;
    onfinish: () => void;
  } = $props();

  type Step = "password" | "plant" | "devices" | "topology" | "layout";

  // The first step is chosen once: signing in on the way does not restart it.
  // svelte-ignore state_referenced_locally
  let step = $state<Step>(signedIn ? "plant" : "password");

  let devices = $state.raw<readonly Device[]>([]);

  let locale = $state(getLocale());

  const titles: Readonly<Record<Step, () => string>> = {
    password: m.password_set,
    plant: m.plant_title,
    devices: m.devices_title,
    topology: m.topology_title,
    layout: m.layout_title,
  };
</script>

<!-- Messages are no state: a new locale renders the step anew; the step itself is kept. -->
{#key locale}
  <main>
    <LocaleSwitch bind:locale />
    <h1>{m.setup_title()}</h1>
    <h2>{titles[step]()}</h2>
    {#if step === "password"}
      <PasswordStep
        {core}
        ondone={() => {
          step = "plant";
        }}
      />
    {:else if step === "plant"}
      <PlantStep
        {core}
        ondone={() => {
          step = "devices";
        }}
      />
    {:else if step === "devices"}
      <DevicesStep
        {core}
        ondone={(added) => {
          devices = added;
          step = "topology";
        }}
      />
    {:else if step === "topology"}
      <TopologyStep
        {core}
        {devices}
        ondone={() => {
          step = "layout";
        }}
      />
    {:else}
      <LayoutStep {core} {devices} ondone={onfinish} />
    {/if}
  </main>
{/key}

<!--
  Settings › Devices: the list, and a level to add a device, change or remove one, or review the
  measuring points after a change (ADR 14). Each level is a hash route (ADR 21): `add`, `topology`,
  or a device's id.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import type { Connection, Core, Device, Listing, Problem } from "../api/core";
  import LoadingRows from "../components/loading-rows.svelte";
  import { m } from "../paraglide/messages.js";
  import Refusal from "../setup/Refusal.svelte";
  import TopologyStep from "../setup/TopologyStep.svelte";
  import AddDevice from "./AddDevice.svelte";
  import DeviceLevel from "./DeviceLevel.svelte";
  import DeviceList from "./DeviceList.svelte";
  import Level from "./Level.svelte";

  let {
    core,
    level,
    onlevel,
  }: {
    core: Core;
    /** The open level, from the hash route; null on the list. */
    level: string | null;
    onlevel: (id: string | null) => void;
  } = $props();

  let listed = $state.raw<{
    devices: readonly Device[];
    connections: readonly Connection[];
    /** The profiles served, which name what each device is read as; none when they do not load. */
    profiles: readonly Listing[];
  }>();

  let refused = $state.raw<Problem>();

  let changed = $state(false);

  /** The device the level names; none on another level, or once it is removed. */
  const open = $derived(listed?.devices.find((d) => String(d.id) === level));

  async function load(): Promise<void> {
    const [devices, connections, profiles] = await Promise.all([
      core.devices(),
      core.connections(),
      core.profiles(),
    ]);

    if ("problem" in devices) {
      refused = devices;

      return;
    }

    listed = {
      devices,
      connections: "problem" in connections ? [] : connections,
      profiles: "problem" in profiles ? [] : profiles,
    };
  }

  onMount(() => {
    void load();
  });

  /** Back on the list after a change, which offers the measuring points' review. */
  async function after(): Promise<void> {
    await load();
    changed = true;
    onlevel(null);
  }

  const back = () => {
    onlevel(null);
  };
</script>

{#if listed === undefined}
  <div class="drill-card">
    {#if refused}<div class="p-4"><Refusal {refused} /></div>{:else}<LoadingRows />{/if}
  </div>
{:else}
  <!-- One grid cell, so nothing reflows: a level slides over the list, which shifts aside. -->
  <div class="grid overflow-x-clip">
    {#if level === "add"}
      <Level back={m.settings_devices()} title={m.settings_device_add()} onback={back}>
        <AddDevice {core} known={listed} onadded={after} />
      </Level>
    {:else if level === "topology"}
      <Level back={m.settings_devices()} title={m.topology_title()} onback={back}>
        <TopologyStep
          {core}
          devices={listed.devices}
          ondone={() => {
            changed = false;
            back();
          }}
        />
      </Level>
    {:else if open === undefined}
      <DeviceList
        {core}
        devices={listed.devices}
        connections={listed.connections}
        profiles={listed.profiles}
        {changed}
        onopen={(id) => {
          onlevel(String(id));
        }}
        onadd={() => {
          onlevel("add");
        }}
        onreview={() => {
          onlevel("topology");
        }}
      />
    {:else}
      <DeviceLevel
        {core}
        device={open}
        connections={listed.connections}
        profiles={listed.profiles}
        onback={back}
        onchanged={after}
      />
    {/if}
  </div>
{/if}

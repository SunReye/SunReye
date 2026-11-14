<!--
  Settings › Devices: the list, and a level to add a device, change or remove one, or review the
  measuring points after a change (ADR 14).
-->
<script lang="ts">
  import { onMount } from "svelte";
  import type { Connection, Core, Device, Problem } from "../api/core";
  import LoadingRows from "../components/loading-rows.svelte";
  import { m } from "../paraglide/messages.js";
  import Refusal from "../setup/Refusal.svelte";
  import TopologyStep from "../setup/TopologyStep.svelte";
  import AddDevice from "./AddDevice.svelte";
  import DeviceLevel from "./DeviceLevel.svelte";
  import DeviceList from "./DeviceList.svelte";
  import Level from "./Level.svelte";

  let { core }: { core: Core } = $props();

  type Shown =
    | { readonly kind: "list" }
    | { readonly kind: "add" }
    | { readonly kind: "device"; readonly id: number }
    | { readonly kind: "topology" };

  let shown = $state.raw<Shown>({ kind: "list" });

  let listed = $state.raw<{ devices: readonly Device[]; connections: readonly Connection[] }>();

  let refused = $state.raw<Problem>();

  let changed = $state(false);

  const open = $derived.by(() => {
    const at = shown;

    return at.kind === "device" ? listed?.devices.find((d) => d.id === at.id) : undefined;
  });

  async function load(): Promise<void> {
    const [devices, connections] = await Promise.all([core.devices(), core.connections()]);

    if ("problem" in devices) refused = devices;
    else listed = { devices, connections: "problem" in connections ? [] : connections };
  }

  onMount(() => {
    void load();
  });

  /** Back on the list after a change, which offers the measuring points' review. */
  async function after(): Promise<void> {
    await load();
    changed = true;
    shown = { kind: "list" };
  }

  const back = () => {
    shown = { kind: "list" };
  };
</script>

{#if listed === undefined}
  <div class="drill-card">
    {#if refused}<div class="p-4"><Refusal {refused} /></div>{:else}<LoadingRows />{/if}
  </div>
{:else if shown.kind === "add"}
  <Level back={m.settings_devices()} title={m.settings_device_add()} onback={back}>
    <AddDevice {core} known={listed} onadded={after} />
  </Level>
{:else if shown.kind === "topology"}
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
    {changed}
    onopen={(id) => {
      shown = { kind: "device", id };
    }}
    onadd={() => {
      shown = { kind: "add" };
    }}
    onreview={() => {
      shown = { kind: "topology" };
    }}
  />
{:else}
  <DeviceLevel
    {core}
    device={open}
    connections={listed.connections}
    onback={back}
    onchanged={after}
  />
{/if}

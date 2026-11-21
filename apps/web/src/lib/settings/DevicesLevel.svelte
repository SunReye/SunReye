<!-- One level of Settings › Devices by its key: the list, adding a device, the measuring points' review, or one device. -->
<script lang="ts">
  import type { Connection, Core, Device, Listing } from "../api/core";
  import { m } from "../paraglide/messages.js";
  import TopologyStep from "../setup/TopologyStep.svelte";
  import AddDevice from "./AddDevice.svelte";
  import DeviceLevel from "./DeviceLevel.svelte";
  import DeviceList from "./DeviceList.svelte";
  import Level from "./Level.svelte";

  let {
    core,
    key,
    known,
    device,
    changed,
    onlevel,
    onchanged,
    onreviewed,
  }: {
    core: Core;
    /** `list`, `add`, `topology` or a device's id. */
    key: string;
    known: {
      readonly devices: readonly Device[];
      readonly connections: readonly Connection[];
      readonly profiles: readonly Listing[];
    };
    /** The device the key names, if any. */
    device: Device | undefined;
    /** A device was changed: the list offers the measuring points' review. */
    changed: boolean;
    onlevel: (id: string | null) => void;
    /** After a device was added, changed or removed. */
    onchanged: () => Promise<void>;
    onreviewed: () => void;
  } = $props();

  const back = () => {
    onlevel(null);
  };
</script>

{#if key === "add"}
  <Level back={m.settings_devices()} title={m.settings_device_add()} onback={back}>
    <AddDevice {core} {known} onadded={onchanged} />
  </Level>
{:else if key === "topology"}
  <Level back={m.settings_devices()} title={m.topology_title()} onback={back}>
    <TopologyStep {core} devices={known.devices} ondone={onreviewed} />
  </Level>
{:else if device !== undefined}
  <DeviceLevel
    {core}
    {device}
    connections={known.connections}
    profiles={known.profiles}
    onback={back}
    {onchanged}
  />
{:else}
  <DeviceList
    {core}
    devices={known.devices}
    connections={known.connections}
    profiles={known.profiles}
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
{/if}

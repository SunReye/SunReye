<!-- One device's level under Settings › Devices: change it, or remove it while its history stays (ADR 3). -->
<script lang="ts">
  import type { Connection, Core, Device, Listing, Problem } from "../api/core";
  import { m } from "../paraglide/messages.js";
  import { readAs } from "../setup/catalogue.ts";
  import DeviceForm from "./DeviceForm.svelte";
  import Level from "./Level.svelte";
  import RemoveConfirm from "./RemoveConfirm.svelte";

  let {
    core,
    device,
    connections,
    profiles,
    onback,
    onchanged,
  }: {
    core: Core;
    device: Device;
    connections: readonly Connection[];
    profiles: readonly Listing[];
    onback: () => void;
    /** After it was changed or removed. */
    onchanged: () => Promise<void>;
  } = $props();

  async function remove(): Promise<Problem | undefined> {
    const problem = await core.removeDevice(device.id);

    if (problem === undefined) await onchanged();

    return problem;
  }
</script>

<Level back={m.settings_devices()} title={device.name} {onback}>
  <DeviceForm
    {core}
    {connections}
    {device}
    readAs={readAs(profiles, device)}
    onsaved={onchanged}
  />
  <RemoveConfirm
    ask={m.settings_device_remove()}
    name={device.name}
    note={m.settings_device_remove_note()}
    onremove={remove}
  />
</Level>

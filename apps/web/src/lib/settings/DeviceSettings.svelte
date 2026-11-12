<!-- One device under Settings › Writes: its writes switch (ADR 7) and each setting's enable (ADR 8). -->
<script lang="ts">
  import type { Capabilities, Core, Device, Problem } from "../api/core";
  import SwitchRow from "../builder/SwitchRow.svelte";
  import { problemText } from "../i18n/problems";
  import { m } from "../paraglide/messages.js";
  import SettingEnable from "./SettingEnable.svelte";

  let {
    core,
    device,
    support,
    onchanged,
  }: {
    core: Core;
    device: Device;
    support: Capabilities["devices"][string];
    /** After the admin switched writes or changed an enable. */
    onchanged: () => void;
  } = $props();

  let problem = $state.raw<Problem>();

  async function writes(on: boolean): Promise<void> {
    const { id, ...draft } = device;
    const answer = await core.changeDevice(id, { ...draft, writes: on });

    problem = "problem" in answer ? answer : undefined;
    onchanged();
  }
</script>

<section aria-label={device.name} class="flex flex-col">
  <SwitchRow
    label={m.settings_device_writes({ name: device.name })}
    hint={support.writes ? undefined : m.settings_device_writes_hint()}
    checked={support.writes}
    onchange={writes}
  />
  {#if problem}<p role="alert" class="px-4 text-sm">{problemText(problem.problem)}</p>{/if}
  <div class="flex flex-col gap-2 px-4 pb-4 text-sm empty:hidden">
    {#each support.settings as setting (setting.key)}
      <SettingEnable {core} device={device.id} {setting} {onchanged} />
    {/each}
  </div>
</section>

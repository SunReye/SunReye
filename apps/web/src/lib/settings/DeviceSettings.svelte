<script lang="ts">
  import type { Capabilities, Core } from "../api/core";
  import { m } from "../paraglide/messages.js";
  import SettingEnable from "./SettingEnable.svelte";
  import SettingField from "./SettingField.svelte";

  let {
    core,
    id,
    device,
    onwritten,
    onchanged,
  }: {
    core: Core;
    id: string;
    device: Capabilities["devices"][string];
    onwritten: () => void;
    /** After the admin enabled a setting or withdrew the enable. */
    onchanged: () => void;
  } = $props();
</script>

<section>
  <h2>{m.settings_device({ id })}</h2>
  {#if !device.writes}
    <p>{m.problem_setting_writes_off()}</p>
  {/if}
  {#each device.settings as setting (setting.key)}
    <SettingField {core} device={Number(id)} {setting} writes={device.writes} {onwritten} />
    <SettingEnable {core} device={Number(id)} {setting} {onchanged} />
  {/each}
</section>

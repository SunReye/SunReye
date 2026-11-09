<script lang="ts">
  import type { Capabilities, Core } from "../api/core";
  import { m } from "../paraglide/messages.js";
  import SettingField from "./SettingField.svelte";

  let {
    core,
    id,
    device,
    onwritten,
  }: {
    core: Core;
    id: string;
    device: Capabilities["devices"][string];
    onwritten: () => void;
  } = $props();
</script>

<section>
  <h2>{m.settings_device({ id })}</h2>
  {#if !device.writes}
    <p>{m.problem_setting_writes_off()}</p>
  {/if}
  {#each device.settings as setting (setting.key)}
    <SettingField {core} device={Number(id)} {setting} writes={device.writes} {onwritten} />
  {/each}
</section>

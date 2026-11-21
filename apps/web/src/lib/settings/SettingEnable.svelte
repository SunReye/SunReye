<!-- One setting under Settings › Writes: its name, what a write may carry, and the admin's enable (ADR 8). -->
<script lang="ts">
  import Refusal, { answered } from "../setup/Refusal.svelte";
  import type { Core, Problem, Setting } from "../api/core";
  import { clock } from "../components/value-editor/editable.ts";
  import { m } from "../paraglide/messages.js";
  import { boundsText } from "./bounds";
  import { settingLabel } from "./setting-label.ts";
  import ToggleRow from "./ToggleRow.svelte";

  let {
    core,
    device,
    setting,
    onchanged,
  }: {
    core: Core;
    device: number;
    setting: Setting;
    onchanged: () => void;
  } = $props();

  let pending = $state(false);
  let problem = $state.raw<Problem>();

  const label = $derived(settingLabel(setting));

  // A verified setting writes with no enable (ADR 8): its switch stays on.
  const verified = $derived(setting.enable === "verified");

  // A time of day reads as clock times, its step in minutes.
  const bounds = $derived(
    setting.time === true && setting.range
      ? m.settings_range({
          min: clock(setting.range.min),
          max: clock(setting.range.max),
          step: `${setting.step} min`,
        })
      : boundsText(setting.range, setting.values, setting.step, setting.labels, setting.unit),
  );

  async function change(on: boolean): Promise<void> {
    pending = true;
    problem = answered(await core.enable(device, setting.key, on));
    pending = false;
    onchanged();
  }
</script>

<ToggleRow
  {label}
  name={m.settings_enable({ key: label })}
  hint={verified ? `${bounds} · ${m.settings_verified()}` : bounds}
  checked={verified || setting.enable === "on"}
  disabled={verified || pending}
  onchange={(on) => void change(on)}
/>
{#if problem}
  <div class="px-4 pb-3"><Refusal refused={problem} /></div>
{/if}

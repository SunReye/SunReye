<!-- One setting under Settings › Writes: its name, what a write may carry, and the admin's enable (ADR 8). -->
<script lang="ts">
  import type { Core, Problem, Setting } from "../api/core";
  import { problemText } from "../i18n/problems";
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

  const bounds = $derived(
    boundsText(setting.range, setting.values, setting.step, setting.labels, setting.unit),
  );

  async function change(on: boolean): Promise<void> {
    pending = true;
    problem = await core.enable(device, setting.key, on);
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
  <p role="alert" class="px-4 pb-3 text-sm text-destructive">{problemText(problem.problem)}</p>
{/if}

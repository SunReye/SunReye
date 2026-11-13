<script lang="ts">
  import { Button } from "#lib/components/ui/button/index.js";
  import type { Core, Problem, Setting } from "../api/core";
  import { problemText } from "../i18n/problems";
  import { m } from "../paraglide/messages.js";
  import { boundsText } from "./bounds";

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

  // A verified setting writes with no enable; the others wait for the admin's (ADR 8).
  const NOTES = { off: m.settings_off, community: m.settings_community };

  let pending = $state(false);
  let problem = $state.raw<Problem>();

  async function change(on: boolean): Promise<void> {
    pending = true;
    problem = await core.enable(device, setting.key, on);
    pending = false;
    onchanged();
  }
</script>

{#if setting.enable === "off" || setting.enable === "community"}
  <div class="flex flex-col gap-2 text-sm">
    <p>{NOTES[setting.enable]()}</p>
    <p>
      {m.settings_allowed({
        bounds: boundsText(setting.range, setting.values, setting.step, setting.labels),
      })}
    </p>
    <Button size="sm" class="self-start" disabled={pending} onclick={() => change(true)}>
      {m.settings_enable({ key: setting.key })}
    </Button>
  </div>
{:else if setting.enable === "on"}
  <Button variant="outline" size="sm" disabled={pending} onclick={() => change(false)}>
    {m.settings_disable({ key: setting.key })}
  </Button>
{/if}
{#if problem}
  <p role="alert">{problemText(problem.problem)}</p>
{/if}

<style>
  p {
    margin: 0;
  }
</style>

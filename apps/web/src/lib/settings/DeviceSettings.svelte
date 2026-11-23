<!-- One device under Settings › Writes: its writes switch (ADR 7), each setting's enable (ADR 8), and the note they share. -->
<script lang="ts">
  import DrillCard from "../components/drill-in/drill-card.svelte";
  import Refusal, { answered } from "../setup/Refusal.svelte";
  import Eyebrow from "../components/eyebrow.svelte";
  import * as Item from "@sunreye/ui/item";
  import type { Capabilities, Core, Device, Problem } from "../api/core";
  import { m } from "../paraglide/messages.js";
  import SettingEnable from "./SettingEnable.svelte";
  import ToggleRow from "./ToggleRow.svelte";

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

  // Said once under the list, not on every row that waits for the admin's enable.
  const notes = $derived(
    [
      support.settings.some((s) => s.enable === "off") && m.settings_off(),
      support.settings.some((s) => s.enable === "community") && m.settings_community(),
    ].filter((note) => note !== false),
  );

  async function writes(on: boolean): Promise<void> {
    const { id, ...draft } = device;
    const answer = await core.changeDevice(id, { ...draft, writes: on });

    problem = "problem" in answer ? answered(answer) : undefined;
    onchanged();
  }
</script>

<section aria-label={device.name} class="flex flex-col">
  <Eyebrow class="px-4 pt-5 pb-2">{device.name}</Eyebrow>
  <DrillCard>
    <Item.Group class="gap-0 divide-y divide-border/60 border-y border-border/60 drill:border-y-0">
      <ToggleRow
        label={m.settings_writes_allowed()}
        name={m.settings_device_writes({ name: device.name })}
        hint={support.writes ? undefined : m.settings_device_writes_hint()}
        checked={support.writes}
        onchange={(on) => void writes(on)}
      />
      {#if problem}<div class="px-4 py-2"><Refusal refused={problem} /></div>{/if}
      {#each support.settings as setting (setting.key)}
        <SettingEnable {core} device={device.id} {setting} {onchanged} />
      {/each}
    </Item.Group>
  </DrillCard>
  {#each notes as note (note)}
    <p class="px-4 pt-2 text-xs text-muted-foreground">{note}</p>
  {/each}
</section>

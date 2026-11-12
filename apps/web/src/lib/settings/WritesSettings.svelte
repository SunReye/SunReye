<!-- Settings › Writes: per device, whether settings may be written and which are enabled (ADR 7, 8). -->
<script lang="ts">
  import { onMount } from "svelte";
  import type { Core } from "../api/core";
  import { problemText } from "../i18n/problems";
  import { m } from "../paraglide/messages.js";
  import DeviceSettings from "./DeviceSettings.svelte";

  let { core }: { core: Core } = $props();

  /** Each device that declares settings, with what it supports. */
  async function load() {
    const [support, devices] = await Promise.all([core.capabilities(), core.devices()]);

    if ("problem" in support) return support;

    if ("problem" in devices) return devices;

    return devices.flatMap((device) => {
      const of = support.devices[String(device.id)];

      return of && of.settings.length > 0 ? [{ device, support: of }] : [];
    });
  }

  // Read again after a switch or an enable changes; the old answer stays until then.
  let answer = $state.raw<Awaited<ReturnType<typeof load>>>();

  async function reload(): Promise<void> {
    answer = await load();
  }

  onMount(() => {
    void reload();
  });
</script>

{#if answer !== undefined}
  {#if "problem" in answer}
    <p role="alert" class="p-4">{problemText(answer.problem)}</p>
  {:else if answer.length === 0}
    <p class="p-4 text-sm text-muted-foreground">{m.settings_none()}</p>
  {:else}
    <div class="flex flex-col divide-y divide-border/60">
      {#each answer as { device, support } (device.id)}
        <DeviceSettings {core} {device} {support} onchanged={reload} />
      {/each}
    </div>
  {/if}
{/if}

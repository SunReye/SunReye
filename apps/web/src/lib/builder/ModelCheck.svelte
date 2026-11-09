<script lang="ts">
  import type { Core, Corrections, Device } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";

  let {
    core,
    devices,
    month,
    hour,
  }: {
    core: Pick<Core, "corrections">;
    /** Names the inverters; a viewer lists none. */
    devices: readonly Device[];
    /** The slider's month 1–12 and hour 0–23, whose learned factor is shown. */
    month: number;
    hour: number;
  } = $props();

  type Input = Corrections["inputs"][number];

  // Read once: the learner runs twice a day.
  const loaded = $derived(core.corrections());

  const locale = getLocale();

  const factorFormat = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const energy = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });

  function line({ device, input, factors, recent }: Input): string {
    const name = devices.find(({ id }) => id === device)?.name ?? String(device);
    const factor = factors.find((cell) => cell.month === month && cell.hour === hour)?.factor ?? 1;
    const correction = m.builder_correction({ name, input, factor: factorFormat.format(factor) });

    if (recent === null || recent === undefined || recent.modelled <= 0) {
      return `${correction} · ${m.builder_no_recent()}`;
    }

    const off = Math.round((recent.measured / recent.modelled - 1) * 100);
    // A typographic minus, as the rest of the screen writes negatives.
    const deviation = `${off < 0 ? "−" : "+"}${energy.format(Math.abs(off))} %`;

    return `${correction} · ${m.builder_recent({
      measured: energy.format(recent.measured),
      modelled: energy.format(recent.modelled),
      deviation,
    })}`;
  }
</script>

{#await loaded then corrections}
  {#if !("problem" in corrections) && corrections.inputs.length > 0}
    <ul aria-label={m.builder_model_check()}>
      {#each corrections.inputs as input (`${String(input.device)}:${String(input.input)}`)}
        <li>{line(input)}</li>
      {/each}
    </ul>
  {/if}
{/await}

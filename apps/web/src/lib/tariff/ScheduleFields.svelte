<script lang="ts">
  import { m } from "../paraglide/messages.js";
  import BandFields from "./BandFields.svelte";
  import { newBand, type ScheduleDraft } from "./draft";

  let { legend, schedule = $bindable() }: { legend: string; schedule: ScheduleDraft } = $props();

  const id = $props.id();
</script>

<fieldset>
  <legend>{legend}</legend>
  <label for="{id}-price">{m.tariff_base_price()}</label>
  <input id="{id}-price" type="number" step="0.001" required bind:value={schedule.price} />
  {#each schedule.bands as band, index (band.key)}
    <BandFields
      bind:band={schedule.bands[index]!}
      onremove={() => {
        schedule.bands = schedule.bands.filter((other) => other !== band);
      }}
    />
  {/each}
  <button type="button" onclick={() => schedule.bands.push(newBand())}>
    {m.tariff_band_add()}
  </button>
</fieldset>

<script lang="ts">
  import { m } from "../paraglide/messages.js";
  import type { BandDraft } from "./draft";

  let { band = $bindable(), onremove }: { band: BandDraft; onremove: () => void } = $props();

  const id = $props.id();

  const DAYS = [
    [1, m.tariff_day_1],
    [2, m.tariff_day_2],
    [3, m.tariff_day_3],
    [4, m.tariff_day_4],
    [5, m.tariff_day_5],
    [6, m.tariff_day_6],
    [7, m.tariff_day_7],
  ] as const;

  // `HH:MM`, 00:00 to 24:00, as the core takes it.
  const CLOCK = "([01][0-9]|2[0-3]):[0-5][0-9]|24:00";
</script>

<fieldset>
  <legend>{m.tariff_band()}</legend>
  {#each DAYS as [day, name] (day)}
    <label><input type="checkbox" value={day} bind:group={band.days} />{name()}</label>
  {/each}
  <label for="{id}-from">{m.tariff_from()}</label>
  <input id="{id}-from" type="text" pattern={CLOCK} required bind:value={band.from} />
  <label for="{id}-to">{m.tariff_to()}</label>
  <input id="{id}-to" type="text" pattern={CLOCK} required bind:value={band.to} />
  <label for="{id}-price">{m.tariff_band_price()}</label>
  <input id="{id}-price" type="number" step="0.001" required bind:value={band.price} />
  <button type="button" onclick={onremove}>{m.tariff_band_remove()}</button>
</fieldset>

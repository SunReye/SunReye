<!-- Bought or fed-in prices: the base price, then each band that overrides it on given days and hours. -->
<script lang="ts">
  import { m } from "../paraglide/messages.js";
  import AddRow from "../settings/AddRow.svelte";
  import BandFields from "./BandFields.svelte";
  import { newBand, type ScheduleDraft } from "./draft";
  import PriceRow from "./PriceRow.svelte";

  let { legend, schedule = $bindable() }: { legend: string; schedule: ScheduleDraft } = $props();
</script>

<fieldset class="flex min-w-0 flex-col">
  <legend class="float-left w-full px-4 pt-5 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
    {legend}
  </legend>
  <div class="clear-left flex flex-col divide-y divide-border/60 border-y border-border/60">
    <PriceRow
      name={m.tariff_base_price()}
      price={schedule.price}
      onchange={(price) => {
        schedule.price = price;
      }}
    />
    {#each schedule.bands as band, index (band.key)}
      <BandFields
        bind:band={schedule.bands[index]!}
        onremove={() => {
          schedule.bands = schedule.bands.filter((other) => other !== band);
        }}
      />
    {/each}
    <AddRow label={m.tariff_band_add()} onclick={() => schedule.bands.push(newBand())} />
  </div>
</fieldset>

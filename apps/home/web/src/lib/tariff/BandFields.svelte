<!-- One band of a schedule: its weekdays, its hours on the time wheels and its price. -->
<script lang="ts">
  import Trash from "@lucide/svelte/icons/trash-2";
  import { Button } from "@sunreye/ui/button";
  import { Checkbox } from "@sunreye/ui/checkbox";
  import { m } from "../paraglide/messages.js";
  import BandTime from "./BandTime.svelte";
  import type { BandDraft } from "./draft";
  import PriceRow from "./PriceRow.svelte";

  let { band = $bindable(), onremove }: { band: BandDraft; onremove: () => void } = $props();

  const DAYS = [
    [1, m.tariff_day_1],
    [2, m.tariff_day_2],
    [3, m.tariff_day_3],
    [4, m.tariff_day_4],
    [5, m.tariff_day_5],
    [6, m.tariff_day_6],
    [7, m.tariff_day_7],
  ] as const;

  function pick(day: number, on: boolean): void {
    band.days = on ? [...band.days, day] : band.days.filter((other) => other !== day);
  }
</script>

<fieldset class="flex min-w-0 flex-col">
  <legend class="sr-only">{m.tariff_band()}</legend>
  <div class="flex flex-col gap-3 px-4 pt-3 pb-1">
    <div class="flex items-center justify-between gap-2">
      <span class="text-xs font-medium text-muted-foreground">{m.tariff_band()}</span>
      <Button
        variant="ghost"
        size="icon-sm"
        class="text-muted-foreground"
        aria-label={m.tariff_band_remove()}
        onclick={onremove}
      >
        <Trash />
      </Button>
    </div>
    <div class="flex flex-wrap gap-x-3 gap-y-2">
      {#each DAYS as [day, name] (day)}
        <label class="flex items-center gap-1.5 text-sm">
          <Checkbox
            checked={band.days.includes(day)}
            onCheckedChange={(on) => pick(day, on)}
          />{name()}
        </label>
      {/each}
    </div>
    <div class="grid grid-cols-2 gap-2">
      <BandTime label={m.tariff_from()} bind:value={band.from} />
      <BandTime label={m.tariff_to()} bind:value={band.to} end />
    </div>
  </div>
  <PriceRow
    name={m.tariff_band_price()}
    price={band.price}
    onchange={(price) => {
      band.price = price;
    }}
  />
</fieldset>

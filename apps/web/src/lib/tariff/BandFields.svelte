<script lang="ts">
  import Trash from "@lucide/svelte/icons/trash-2";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Checkbox } from "#lib/components/ui/checkbox/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import { m } from "../paraglide/messages.js";
  import BandTime from "./BandTime.svelte";
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

  function pick(day: number, on: boolean): void {
    band.days = on ? [...band.days, day] : band.days.filter((other) => other !== day);
  }
</script>

<fieldset class="flex flex-col gap-3 border-t border-border/60 pt-3">
  <legend class="float-left mb-1 text-xs font-medium text-muted-foreground">
    {m.tariff_band()}
  </legend>
  <div class="clear-left flex flex-wrap gap-x-4 gap-y-2">
    {#each DAYS as [day, name] (day)}
      <label class="flex items-center gap-1.5 text-sm">
        <Checkbox
          checked={band.days.includes(day)}
          onCheckedChange={(on) => pick(day, on)}
        />{name()}
      </label>
    {/each}
  </div>
  <div class="flex flex-wrap items-end gap-2">
    <BandTime label={m.tariff_from()} bind:value={band.from} />
    <BandTime label={m.tariff_to()} bind:value={band.to} end />
    <label class="flex flex-col gap-1.5 text-sm" for="{id}-price">
      {m.tariff_band_price()}
      <Input
        id="{id}-price"
        type="number"
        step="0.001"
        required
        class="w-32"
        bind:value={band.price}
      />
    </label>
    <Button
      variant="ghost"
      size="icon"
      class="ml-auto text-muted-foreground"
      aria-label={m.tariff_band_remove()}
      onclick={onremove}><Trash /></Button
    >
  </div>
</fieldset>

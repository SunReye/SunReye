<script lang="ts">
  import Plus from "@lucide/svelte/icons/plus";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import { m } from "../paraglide/messages.js";
  import BandFields from "./BandFields.svelte";
  import { newBand, type ScheduleDraft } from "./draft";

  let { legend, schedule = $bindable() }: { legend: string; schedule: ScheduleDraft } = $props();

  const id = $props.id();
</script>

<fieldset class="flex flex-col gap-3">
  <legend class="float-left mb-1 text-sm font-semibold">{legend}</legend>
  <label class="clear-left flex flex-col gap-1.5 text-sm" for="{id}-price">
    {m.tariff_base_price()}
    <Input
      id="{id}-price"
      type="number"
      step="0.001"
      required
      class="w-32"
      bind:value={schedule.price}
    />
  </label>
  {#each schedule.bands as band, index (band.key)}
    <BandFields
      bind:band={schedule.bands[index]!}
      onremove={() => {
        schedule.bands = schedule.bands.filter((other) => other !== band);
      }}
    />
  {/each}
  <Button variant="outline" class="self-start" onclick={() => schedule.bands.push(newBand())}>
    <Plus />{m.tariff_band_add()}
  </Button>
</fieldset>

<!-- The builder's sample weathers (ADR 23 "Builder"): one button on the canvas, the stored weather until another is picked. -->
<script lang="ts" module>
  export type { Sample } from "./samples.ts";
</script>

<script lang="ts">
  import CloudSun from "@lucide/svelte/icons/cloud-sun";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as DropdownMenu from "#lib/components/ui/dropdown-menu/index.js";
  import { m } from "../paraglide/messages.js";
  import { SAMPLES, type Sample } from "./samples.ts";

  let { sample = $bindable() }: { sample: Sample | null } = $props();

  const STORED = "stored";

  const labels: Readonly<Record<Sample, () => string>> = {
    clear: m.builder_weather_clear,
    cloudy: m.builder_weather_cloudy,
    rain: m.builder_weather_rain,
    thunder: m.builder_weather_thunder,
    snow: m.builder_weather_snow,
    fog: m.builder_weather_fog,
  };

</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        variant="ghost"
        aria-label={m.builder_weather()}
        class={[
          "glass-ambient size-11 ring-1 ring-border/60 elevation-1",
          sample !== null && "text-primary",
        ]}
      >
        <CloudSun />
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end" class="w-44">
    <DropdownMenu.RadioGroup
      bind:value={
        () => sample ?? STORED,
        (value) => {
          sample = SAMPLES.find((each) => each === value) ?? null;
        }
      }
    >
      <DropdownMenu.RadioItem closeOnSelect class="min-h-10" value={STORED}
        >{m.builder_weather_stored()}</DropdownMenu.RadioItem
      >
      <DropdownMenu.Separator />
      {#each SAMPLES as each (each)}
        <DropdownMenu.RadioItem closeOnSelect class="min-h-10" value={each}>{labels[each]()}</DropdownMenu.RadioItem>
      {/each}
    </DropdownMenu.RadioGroup>
  </DropdownMenu.Content>
</DropdownMenu.Root>

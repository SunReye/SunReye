<!--
  The one range control (ADR 21), shared by History, Forecast, Tariff and the detail sheets:
  day … custom, arrows or a swipe on the label step. It holds no state: its model owns the range.
-->
<script lang="ts">
  import * as ToggleGroup from "#lib/components/ui/toggle-group/index.js";
  import { haptics } from "../haptics.ts";
  import { m } from "../paraglide/messages.js";
  import CustomBounds from "./CustomBounds.svelte";
  import { indicator } from "./indicator.ts";
  import { isKind, type Kind, type Ranged } from "./range.ts";
  import Stepper from "./Stepper.svelte";

  const KINDS: [Kind, () => string][] = [
    ["day", m.range_day],
    ["week", m.range_week],
    ["month", m.range_month],
    ["year", m.range_year],
    ["custom", m.range_custom],
  ];

  let { model }: { model: Ranged } = $props();

  const kind = $derived(model.range.kind);
</script>

<!-- One row where it fits; below that the stepper takes its own full-width row, arrows at the ends. -->
<div class="@container flex flex-col gap-2">
  <div
    class="flex flex-col gap-2 @[430px]:flex-row @[430px]:items-center @[430px]:justify-center @[430px]:gap-3"
  >
    <ToggleGroup.Root
      type="single"
      variant="outline"
      size="sm"
      class="grid w-full grid-cols-5 data-indicator:before:hidden! @[430px]:flex @[430px]:w-fit"
      bind:value={
        () => kind,
        (v: string) => {
          if (!isKind(v) || v === kind) return;
          haptics.selection();
          model.setKind(v);
        }
      }
      aria-label={m.range_kind()}
    >
      <!-- kbase's sliding pill, on a transform. -->
      <span class="rounded-[2px] bg-foreground/[0.13]" {@attach indicator('[data-state="on"]')}
      ></span>
      {#each KINDS as [id, text] (id)}
        <ToggleGroup.Item value={id} class="px-2.5 text-xs">{text()}</ToggleGroup.Item>
      {/each}
    </ToggleGroup.Root>
    <Stepper
      label={model.label}
      dir={model.via.dir}
      canPrev={model.canPrev}
      canNext={model.canNext}
      onstep={model.step}
    />
  </div>
  {#if kind === "custom"}
    <CustomBounds custom={model.custom} />
  {/if}
</div>

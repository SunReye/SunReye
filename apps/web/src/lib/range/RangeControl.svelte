<!--
  The one range control (ADR 21), shared by History, Forecast, Tariff and the detail sheets:
  day … custom, arrows or a swipe on the label step. It holds no state: its model owns the range.
-->
<script lang="ts">
  import Segmented from "../components/segmented.svelte";
  import { m } from "../paraglide/messages.js";
  import CustomBounds from "./CustomBounds.svelte";
  import type { Kind, Ranged } from "./range.ts";
  import Stepper from "./Stepper.svelte";

  const KINDS: [Kind, () => string][] = [
    ["day", m.range_day],
    ["week", m.range_week],
    ["month", m.range_month],
    ["year", m.range_year],
    ["custom", m.range_custom],
  ];

  let {
    model,
    kinds,
  }: {
    model: Ranged;
    /** The kinds offered where a screen takes fewer than all. */
    kinds?: readonly Kind[] | undefined;
  } = $props();

  const offered = $derived(kinds ? KINDS.filter(([id]) => kinds.includes(id)) : KINDS);

  const kind = $derived(model.range.kind);
</script>

<!-- One row where it fits; below that the stepper takes its own full-width row, arrows at the ends. -->
<div class="@container flex flex-col gap-2">
  <div
    class="flex flex-col gap-2 @[500px]:flex-row @[500px]:items-center @[500px]:justify-center @[500px]:gap-3"
  >
    <div class="@[500px]:w-fit @[500px]:shrink-0">
      <Segmented
        options={offered.map(([id, text]) => [id, text()] as const)}
        value={kind}
        label={m.range_kind()}
        fill
        onchange={(next) => model.setKind(next)}
      />
    </div>
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

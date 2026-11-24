<!--
  The picked traced line on the tracing bar (ADR 20): whether it is an eave or a ridge, its two
  points' heights by number, its dormer's eave and ridge heights where it is a dormer's, and
  removing it.
-->
<script lang="ts">
  import Trash from "@lucide/svelte/icons/trash-2";
  import type { Kind } from "@sunreye/scene";
  import { Button } from "@sunreye/ui/button";
  import * as ToggleGroup from "@sunreye/ui/toggle-group";
  import { m } from "../paraglide/messages.js";
  import HeightButton from "./HeightButton.svelte";
  import type { TracingMode } from "./tracing-mode.svelte.ts";

  let {
    mode,
    picked,
  }: {
    mode: TracingMode;
    picked: { kind: Kind | undefined; heights: readonly [number, number] };
  } = $props();
</script>

<ToggleGroup.Root
  type="single"
  size="sm"
  variant="outline"
  aria-label={m.builder_trace_kind()}
  value={picked.kind ?? ""}
  onValueChange={(kind) => {
    if (kind === "eave" || kind === "ridge") mode.mark(kind satisfies Kind);
  }}
>
  <ToggleGroup.Item value="eave">{m.builder_trace_eave()}</ToggleGroup.Item>
  <ToggleGroup.Item value="ridge">{m.builder_trace_ridge()}</ToggleGroup.Item>
</ToggleGroup.Root>
<HeightButton
  name={m.builder_trace_start()}
  value={picked.heights[0]}
  onchange={(height) => {
    mode.raise(0, height);
  }}
/>
<HeightButton
  name={m.builder_trace_end()}
  value={picked.heights[1]}
  onchange={(height) => {
    mode.raise(1, height);
  }}
/>
{#if mode.dormer}
  <HeightButton
    name={m.builder_trace_dormer_eaves()}
    value={mode.dormer.eave}
    onchange={(height) => {
      mode.raiseDormer("eave", height);
    }}
  />
  {#if mode.dormer.ridged}
    <HeightButton
      name={m.builder_trace_dormer_ridge()}
      value={mode.dormer.ridge}
      onchange={(height) => {
        mode.raiseDormer("ridge", height);
      }}
    />
  {/if}
{/if}
<Button
  variant="ghost"
  size="sm"
  onclick={() => {
    mode.remove();
  }}
>
  <Trash data-icon="inline-start" />
  {m.builder_trace_remove()}
</Button>

<!--
  The forecast line an inverter's chart shows, picked inverter first, then MPPT input, then string
  (ADR 17): the total, then each input's group with the whole input and its strings. Estimated
  strings carry "≈", explained once at the list's foot.
-->
<script lang="ts">
  import SelectField from "../components/select-field.svelte";
  import type { Choice } from "../components/select/choices.ts";
  import { m } from "../paraglide/messages.js";
  import { lineName, type Line } from "./forecast.ts";

  let {
    lines,
    value,
    onpick,
  }: { lines: readonly Line[]; value: string; onpick: (series: string) => void } = $props();

  const chosen = $derived(lines.find((l) => l.series === value) ?? lines[0]!);

  /** Each line under its input's heading; the trigger names it whole. */
  const options = $derived(
    lines.map((l) => {
      const option: Choice = { value: l.series, label: lineName(l) };
      const input = lines.find((i) => i.kind === "input" && i.input === l.input);

      return l.kind === "total" || input === undefined ? option : { ...option, group: input.label };
    }),
  );

  /** What a line's row says inside its input's group. */
  function short(l: Line): string {
    if (l.kind === "input") return m.forecast_input_total();

    return l.estimated ? `${l.label} ≈` : l.label;
  }

  const estimates = $derived(lines.some((l) => l.estimated));
</script>

{#snippet item(choice: Choice)}
  {@const l = lines.find((each) => each.series === choice.value)}
  <span class={["truncate", l?.kind === "string" && "pl-3"]}>{l ? short(l) : choice.label}</span>
{/snippet}

<SelectField
  value={chosen.series}
  {options}
  label={m.forecast_line()}
  size="sm"
  {item}
  note={estimates ? m.forecast_estimated_note() : undefined}
  onchange={onpick}
  class="max-w-[60%] shrink-0 text-xs"
/>

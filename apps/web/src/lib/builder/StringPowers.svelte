<!-- Each string's power at the slider's instant, as one glass notice on the canvas (ADR 20). -->
<script lang="ts">
  import type { StringDraft } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";

  let {
    strings,
    watts,
    measured,
  }: {
    strings: readonly StringDraft[];
    /** By string position; null where it is dark or unknown. */
    watts: readonly (number | null)[];
    /** Only measured history is a reading; the forecast and a clear sky are estimates (ADR 20). */
    measured: boolean;
  } = $props();

  const format = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 0 });

  const prefix = $derived(measured ? "" : "≈");
</script>

<ul
  aria-label={m.builder_strings_power()}
  class="glass-ambient flex flex-wrap gap-x-3 gap-y-0.5 rounded-md px-2.5 py-1.5 tabular-nums"
>
  {#each strings as { name }, i (i)}
    {@const power = watts[i] ?? null}
    <li class="text-foreground">
      {power === null
        ? m.builder_string_dark({ name })
        : m.builder_string_power({ name, power: `${prefix}${format.format(power)} W` })}
    </li>
  {/each}
</ul>

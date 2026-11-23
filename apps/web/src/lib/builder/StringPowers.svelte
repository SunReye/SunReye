<!-- Where the powers come from and each string's power at the slider's instant, beside the colour
  its modules glow in (ADR 20); nothing without strings. -->
<script lang="ts">
  import type { StringDraft } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";
  import type { Source } from "./moment.ts";
  import { stringCss } from "@sunreye/builder/builder/scene.ts";

  let {
    strings,
    watts,
    source,
  }: {
    strings: readonly StringDraft[];
    /** By string position; null where it is dark or unknown. */
    watts: readonly (number | null)[];
    /** Where the powers come from; undefined while the day loads. */
    source: Source | undefined;
  } = $props();

  const format = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 0 });

  const sources: Readonly<Record<Source, () => string>> = {
    measured: m.builder_source_measured,
    forecast: m.builder_source_forecast,
    clearSky: m.builder_source_clear_sky,
  };

  // Only measured history is a reading; the forecast and a clear sky are estimates (ADR 20).
  const prefix = $derived(source === "measured" ? "" : "≈");
</script>

{#if strings.length > 0}
  {#if source !== undefined}
    <span class="shrink-0">{sources[source]()}</span>
  {/if}
  <ul aria-label={m.builder_strings_power()} class="flex shrink-0 items-center gap-3 tabular-nums">
    {#each strings as { name }, i (i)}
      {@const power = watts[i] ?? null}
      <li class="flex items-center gap-1.5 text-foreground">
        <span data-swatch class="size-2 rounded-full" style:background-color={stringCss(i)}></span>
        {power === null
          ? m.builder_string_dark({ name })
          : m.builder_string_power({ name, power: `${prefix}${format.format(power)} W` })}
      </li>
    {/each}
  </ul>
{/if}

<script lang="ts">
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";
  import type { Source } from "./moment.ts";

  let {
    day = $bindable(),
    minutes = $bindable(),
    source,
    strings,
    located,
  }: {
    /** `YYYY-MM-DD` in the browser's calendar. */
    day: string;
    /** Since the day's midnight. */
    minutes: number;
    /** Undefined while the day loads. */
    source: Source | undefined;
    /** Each string's name and its watts at the instant, null without a value. */
    strings: readonly { readonly name: string; readonly watts: number | null }[];
    /** Whether the plant's location is known. */
    located: boolean;
  } = $props();

  const sources: Readonly<Record<Source, () => string>> = {
    measured: m.builder_source_measured,
    forecast: m.builder_source_forecast,
    clearSky: m.builder_source_clear_sky,
  };

  const format = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 0 });

  const clock = $derived(
    [Math.floor(minutes / 60), minutes % 60].map((part) => String(part).padStart(2, "0")).join(":"),
  );

  // Only measured history is a reading; the forecast and a clear sky are estimates (ADR 20).
  const prefix = $derived(source === "measured" ? "" : "≈");
</script>

<fieldset>
  <label>
    {m.builder_day()}
    <input type="date" required bind:value={day} />
  </label>
  <label>
    {m.builder_time()}
    <input type="range" min="0" max="1425" step="15" bind:value={minutes} />
  </label>
  <span>{clock}</span>
  {#if source !== undefined}
    <p>{sources[source]()}</p>
  {/if}
  {#if !located}
    <p>{m.builder_no_location()}</p>
  {/if}
  <ul aria-label={m.builder_strings_power()}>
    {#each strings as { name, watts }, i (i)}
      <li>
        {watts === null
          ? m.builder_string_dark({ name })
          : m.builder_string_power({ name, power: `${prefix}${format.format(watts)} W` })}
      </li>
    {/each}
  </ul>
</fieldset>

<style>
  fieldset {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 0.5rem 1rem;
  }

  ul {
    flex-basis: 100%;
    margin: 0;
  }
</style>

<!-- The prices behind the money (ADR 12): the tariff in force prices the bill; it is edited in Settings › Tariff. -->
<script lang="ts">
  import type { Core, Tariff } from "../api/core.ts";
  import TextLink from "../components/text-link.svelte";
  import { m } from "../paraglide/messages.js";
  import { plantNow } from "../plant-day.ts";
  import { shortDay } from "../range/calendar.ts";
  import { ctPerKwh } from "../tariff/format.ts";

  let { core, zone }: { core: Readonly<Pick<Core, "tariff">>; zone: string } = $props();

  let tariff = $state.raw<Tariff | null | undefined>();

  $effect(() => {
    let live = true;

    void core.tariff().then((read) => {
      if (live) tariff = "problem" in read ? null : read;

      return read;
    });

    return () => {
      live = false;
    };
  });

  const since = (t: Tariff) => shortDay(plantNow(zone, new Date(t.appliesFrom)).day, true);
</script>

<div class="flex min-h-[300px] flex-col gap-4">
  {#if tariff}
    <section aria-label={m.stats_tariff_now()}>
      <h3 class="pb-1 text-xs font-medium text-muted-foreground">{m.stats_tariff_now()}</h3>
      <ul class="divide-y divide-border/60 border-y border-border/60">
        <li class="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 py-2 text-sm tabular-nums">
          <span class="w-36 font-medium">{m.stats_tariff_from({ date: since(tariff) })}</span>
          <span>{m.stats_tariff_import({ price: ctPerKwh(tariff.import.price) })}</span>
          <span>{m.stats_tariff_export({ price: ctPerKwh(tariff.export.price) })}</span>
          {#if tariff.import.bands.length + tariff.export.bands.length > 0}
            <span class="ml-auto text-xs text-muted-foreground">
              {m.stats_tariff_bands({
                count: tariff.import.bands.length + tariff.export.bands.length,
              })}
            </span>
          {/if}
        </li>
      </ul>
    </section>
    <p class="max-w-[68ch] text-xs text-muted-foreground">{m.stats_tariff_note()}</p>
  {:else if tariff === null}
    <div class="flex flex-col justify-center gap-2 py-8">
      <h3 class="text-base font-semibold">{m.stats_tariff_none()}</h3>
      <p class="max-w-[52ch] text-sm text-muted-foreground">{m.stats_tariff_none_text()}</p>
    </div>
  {/if}
  <TextLink href="#/settings?group=tariff" class="self-start text-sm">
    {m.stats_tariff_edit()}
  </TextLink>
</div>

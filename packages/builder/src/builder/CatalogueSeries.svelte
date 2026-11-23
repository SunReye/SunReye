<!-- One series of the module catalogue: maker and series, the datasheets it was copied from, a row per power class. -->
<script lang="ts">
  import * as Item from "@sunreye/ui/item";
  import type { Datasheet } from "@sunreye/scene";
  import DrillRow from "../components/drill-in/drill-row.svelte";
  import { m } from "../paraglide/messages.js";
  import type { Series } from "./catalogue.ts";

  let {
    maker,
    series,
    adding,
    onpick,
  }: {
    maker: string;
    series: Series;
    /** While a pick is being added; the rows wait. */
    adding: boolean;
    onpick: (datasheet: Readonly<Datasheet>) => void;
  } = $props();

  const uid = $props.id();
</script>

<h3 id="{uid}-series" class="px-4 pt-4 text-xs font-medium text-muted-foreground">
  {maker} · {series.name}
</h3>
{#each series.sources as source (source.url + source.revision)}
  <p class="px-4 text-[11px] leading-4 text-muted-foreground/80">
    {m.builder_module_source({ title: source.title, revision: source.revision })}
  </p>
{/each}
<Item.Group aria-labelledby="{uid}-series" class="mt-1 gap-0 divide-y divide-border/60">
  {#each series.modules as entry (entry.key)}
    <DrillRow
      group={{
        id: entry.key,
        label: entry.datasheet.name,
        summary: entry.summary,
        disabled: adding,
      }}
      onclick={() => {
        onpick(entry.datasheet);
      }}
    />
  {/each}
</Item.Group>

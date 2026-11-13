<!-- The picker's sheet body: the catalogue by manufacturer and family, or why it is not there. -->
<script lang="ts">
  import type { Listing, Problem } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import { catalogue, covers } from "./catalogue.ts";
  import ProfileMaker from "./ProfileMaker.svelte";
  import Refusal from "./Refusal.svelte";

  let {
    listings,
    refused,
    query,
    value,
    onpick,
  }: {
    /** Undefined while the core answers. */
    listings: readonly Readonly<Listing>[] | undefined;
    refused: Problem | undefined;
    query: string;
    value: string;
    onpick: (id: string) => void;
  } = $props();

  const groups = $derived(listings === undefined ? [] : catalogue(listings, query));

  const families = $derived(new Set(listings?.filter((l) => covers(l, listings ?? []))));
</script>

{#if refused !== undefined}
  <Refusal {refused} />
{:else if listings === undefined}
  <div class="flex flex-col gap-2 pt-2" aria-hidden="true">
    {#each [0, 1, 2, 3] as row (row)}<div class="h-12 animate-pulse rounded-md bg-muted"></div>{/each}
  </div>
{:else if groups.length === 0}
  <p class="px-1 py-6 text-center text-sm text-muted-foreground">
    {m.profile_none({ query: query.trim() })}
  </p>
{:else}
  {#each groups as maker (maker.name)}<ProfileMaker {maker} {families} {value} {onpick} />{/each}
{/if}

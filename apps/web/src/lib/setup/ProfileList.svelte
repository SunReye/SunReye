<!-- The picker's sheet body: the catalogue by manufacturer and family, or why it is not there. -->
<script lang="ts">
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";
  import type { Listing, Problem } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import { catalogue } from "./catalogue.ts";
  import ProfileMaker from "./ProfileMaker.svelte";
  import Refusal from "./Refusal.svelte";

  let {
    listings,
    refused,
    query,
    value,
    variant,
    onpick,
  }: {
    /** Undefined while the core answers. */
    listings: readonly Readonly<Listing>[] | undefined;
    refused: Problem | undefined;
    query: string;
    /** The profile chosen, and which of its variants. */
    value: string;
    variant: string | undefined;
    onpick: (profile: string, variant?: string) => void;
  } = $props();

  const groups = $derived(listings === undefined ? [] : catalogue(listings, query));
</script>

{#if refused !== undefined}
  <Refusal {refused} />
{:else if listings === undefined}
  <div class="flex flex-col gap-2 pt-2" aria-hidden="true">
    {#each [0, 1, 2, 3] as row (row)}<Skeleton class="h-12" />{/each}
  </div>
{:else if groups.length === 0}
  <p class="px-1 py-6 text-center text-sm text-muted-foreground">
    {m.profile_none({ query: query.trim() })}
  </p>
{:else}
  {#each groups as maker (maker.name)}<ProfileMaker {maker} {value} {variant} {onpick} />{/each}
{/if}

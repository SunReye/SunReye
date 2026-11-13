<!--
  Chooses a device's profile from what the core serves: a field showing the choice, and a bottom
  sheet that lists the catalogue by manufacturer and family, filtered as the admin types.
-->
<script lang="ts">
  import { Pressable } from "../components/ui/pressable/index.js";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Search from "@lucide/svelte/icons/search";
  import { onMount } from "svelte";
  import type { Core, Listing, Problem } from "../api/core.ts";
  import ResponsiveSheet from "#lib/components/responsive-sheet.svelte";
  import { Input } from "#lib/components/ui/input/index.js";
  import { m } from "../paraglide/messages.js";
  import { rated } from "./catalogue.ts";
  import ProfileList from "./ProfileList.svelte";

  let {
    core,
    value,
    label,
    onpick,
  }: { core: Core; value: string; label: string; onpick: (id: string) => void } = $props();

  let listings = $state.raw<readonly Listing[]>();

  let refused = $state.raw<Problem>();

  let open = $state(false);

  let query = $state("");

  const chosen = $derived(listings?.find((listing) => listing.id === value));

  const power = $derived(rated(chosen?.acRating));

  async function load(): Promise<void> {
    const answer = await core.profiles();

    if ("problem" in answer) refused = answer;
    else listings = answer;
  }

  onMount(() => {
    void load();
  });

  function pick(id: string): void {
    open = false;
    onpick(id);
  }
</script>

<Pressable
  aria-label={label}
  aria-haspopup="dialog"
  class="flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-transparent px-2.5 text-left text-base bevel-well outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
  onclick={() => {
    query = "";
    open = true;
  }}
>
  {#if chosen !== undefined}
    <span class="truncate">{chosen.name}</span>
    {#if power !== undefined}
      <span class="shrink-0 text-muted-foreground tabular-nums">{power}</span>
    {/if}
  {:else if value !== ""}
    <span class="truncate">{value}</span>
  {:else}
    <span class="truncate text-muted-foreground">{m.profile_choose()}</span>
  {/if}
  <ChevronDown class="ml-auto size-4 shrink-0 text-muted-foreground" />
</Pressable>

<ResponsiveSheet bind:open label={m.profile_choose()}>
  <div class="flex flex-col gap-3 px-4 pt-1">
    <h2 class="px-1 text-lg font-semibold">{m.profile_choose()}</h2>
    <div class="relative" data-vaul-no-drag>
      <Search
        class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        autocomplete="off"
        enterkeyhint="search"
        aria-label={m.profile_search()}
        placeholder={m.profile_search()}
        class="pl-8"
        bind:value={query}
      />
    </div>
  </div>
  <div class="mt-3 h-[min(60dvh,34rem)] overflow-y-auto overscroll-contain px-4 pb-2 no-scrollbar">
    <ProfileList {listings} {refused} {query} {value} onpick={pick} />
  </div>
</ResponsiveSheet>

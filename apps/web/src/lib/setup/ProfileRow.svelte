<!-- One profile in the picker: its name, a family or community tag under it, its rating beside it. -->
<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import type { Listing } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import { rated } from "./catalogue.ts";

  let {
    listing,
    family,
    chosen,
    onpick,
  }: {
    listing: Readonly<Listing>;
    /** Whether it is a family profile, covering every model of its series. */
    family: boolean;
    chosen: boolean;
    onpick: (id: string) => void;
  } = $props();

  const power = $derived(rated(listing.acRating));

  // A family's rating is its largest model's.
  const rating = $derived(
    power !== undefined && family ? m.profile_up_to({ power }) : power,
  );

  const tags = $derived(
    [
      family ? m.profile_family() : undefined,
      listing.official ? undefined : m.profile_community(),
    ]
      .filter((tag) => tag !== undefined)
      .join(", "),
  );

  const spoken = $derived(
    [listing.name, [tags, rating ?? ""].filter((part) => part !== "").join(", ")]
      .filter((part) => part !== "")
      .join(" "),
  );
</script>

<li>
  <button
    type="button"
    aria-label={spoken}
    aria-current={chosen ? "true" : undefined}
    class="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/60 active:bg-muted"
    onclick={() => {
      onpick(listing.id);
    }}
  >
    <span class="flex min-w-0 flex-col">
      <span class="truncate text-[15px] font-medium">{listing.name}</span>
      {#if tags !== ""}<span class="truncate text-xs text-muted-foreground">{tags}</span>{/if}
    </span>
    <span class="ml-auto flex shrink-0 items-center gap-2">
      {#if rating !== undefined}
        <span class="text-sm text-muted-foreground tabular-nums">{rating}</span>
      {/if}
      {#if chosen}<Check class="size-4 text-brand" />{/if}
    </span>
  </button>
</li>

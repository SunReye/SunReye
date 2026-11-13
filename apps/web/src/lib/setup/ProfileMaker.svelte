<!-- One manufacturer in the picker: its name, then each family as a group of rows. -->
<script lang="ts">
  import type { Listing } from "../api/core.ts";
  import type { Manufacturer } from "./catalogue.ts";
  import ProfileRow from "./ProfileRow.svelte";

  let {
    maker,
    families,
    value,
    onpick,
  }: {
    maker: Manufacturer;
    /** The family profiles served. */
    families: ReadonlySet<Readonly<Listing>>;
    value: string;
    onpick: (id: string) => void;
  } = $props();
</script>

<section class="pb-3">
  <h3
    class="px-1 pt-2 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase"
  >
    {maker.name}
  </h3>
  <div class="flex flex-col gap-2">
    {#each maker.families as family (family[0]?.id)}
      <ul
        class="glass-ambient divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60"
      >
        {#each family as listing (listing.id)}
          <ProfileRow
            {listing}
            family={families.has(listing)}
            chosen={listing.id === value}
            {onpick}
          />
        {/each}
      </ul>
    {/each}
  </div>
</section>

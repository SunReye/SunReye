<!-- One manufacturer in the picker: its name, then each family as a group of rows. -->
<script lang="ts">
  import Eyebrow from "../components/eyebrow.svelte";
  import * as Card from "#lib/components/ui/card/index.js";
  import type { Manufacturer } from "./catalogue.ts";
  import ProfileRow from "./ProfileRow.svelte";

  let {
    maker,
    value,
    variant,
    onpick,
  }: {
    maker: Manufacturer;
    value: string;
    variant: string | undefined;
    onpick: (profile: string, variant?: string) => void;
  } = $props();
</script>

<section class="pb-3">
  <Eyebrow class="px-1 pt-2 pb-2">{maker.name}</Eyebrow>
  <div class="flex flex-col gap-2">
    {#each maker.families as family (family[0]?.profile)}
      <Card.Root element="ul" class="glass-ambient gap-0 divide-y divide-border/60 py-0">
        {#each family as offer (offer.variant ?? "")}
          <ProfileRow
            {offer}
            chosen={offer.profile === value && offer.variant === variant}
            {onpick}
          />
        {/each}
      </Card.Root>
    {/each}
  </div>
</section>

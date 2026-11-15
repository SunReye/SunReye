<!-- One manufacturer in the picker: its name, then each family as a group of rows. -->
<script lang="ts">
  import Eyebrow from "../components/eyebrow.svelte";
  import GlassCard from "../components/glass-card.svelte";
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
      <GlassCard element="ul" class="divide-y divide-border/60">
        {#each family as model (model.variant ?? "")}
          <ProfileRow
            {model}
            chosen={model.profile === value && model.variant === variant}
            {onpick}
          />
        {/each}
      </GlassCard>
    {/each}
  </div>
</section>

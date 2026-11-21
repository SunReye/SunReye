<!-- One offer in the picker: its name, a family or community tag under it, its rating beside it. -->
<script lang="ts">
  import { Pressable } from "../components/ui/pressable/index.js";
  import Check from "@lucide/svelte/icons/check";
  import { m } from "../paraglide/messages.js";
  import { power, type Offer } from "./catalogue.ts";

  let {
    offer,
    chosen,
    onpick,
  }: {
    offer: Readonly<Offer>;
    chosen: boolean;
    onpick: (profile: string, variant?: string) => void;
  } = $props();

  const rating = $derived(power(offer));

  const tags = $derived(
    [
      offer.base ? m.profile_family() : undefined,
      offer.official ? undefined : m.profile_community(),
    ]
      .filter((tag) => tag !== undefined)
      .join(", "),
  );

  const spoken = $derived(
    [offer.name, [tags, rating ?? ""].filter((part) => part !== "").join(", ")]
      .filter((part) => part !== "")
      .join(" "),
  );
</script>

<li>
  <Pressable
    feedback
    aria-label={spoken}
    aria-current={chosen ? "true" : undefined}
    selected={chosen}
    class="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left"
    onclick={() => {
      onpick(offer.profile, offer.variant);
    }}
  >
    <span class="flex min-w-0 flex-col">
      <span class="truncate text-[15px] font-medium">{offer.name}</span>
      {#if tags !== ""}<span class="truncate text-xs text-muted-foreground">{tags}</span>{/if}
    </span>
    <span class="ml-auto flex shrink-0 items-center gap-2">
      {#if rating !== undefined}
        <span class="text-sm text-muted-foreground tabular-nums">{rating}</span>
      {/if}
      {#if chosen}<Check class="size-4 text-brand" />{/if}
    </span>
  </Pressable>
</li>

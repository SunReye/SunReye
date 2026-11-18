<!-- The savings sheet's way to the tariff, at the sheet's range (ADR 21). -->
<script lang="ts">
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import { m } from "../paraglide/messages.js";
  import { rangeParams } from "../range/params.ts";
  import type { RangeRoute } from "../range/route.svelte.ts";

  let { route }: { route: RangeRoute } = $props();

  const href = $derived.by(() => {
    const query = Object.entries(rangeParams(route.place.cal, route.range)).filter(
      (e): e is [string, string] => e[1] !== null,
    );

    return `#/tariff?${new URLSearchParams(query).toString()}`;
  });
</script>

<a
  {href}
  class="group flex items-center gap-2 self-start text-sm font-medium text-brand outline-none hover:underline focus-visible:underline"
>
  {m.detail_tariff_link()}
  <ArrowRight class="size-4 transition-transform group-hover:translate-x-0.5" />
</a>

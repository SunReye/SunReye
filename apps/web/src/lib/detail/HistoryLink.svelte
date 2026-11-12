<!-- The sheet's one way onward, at the end where the scan ends: History at the sheet's range. -->
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

    return `#/history?${new URLSearchParams(query).toString()}`;
  });
</script>

<a
  {href}
  class="group mt-auto flex items-center justify-between gap-3 border-t border-border/60 px-5 py-4 text-left text-sm font-medium text-brand outline-none transition-colors hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-6"
>
  {m.detail_history({ range: route.label })}
  <ArrowRight class="size-4 transition-transform group-hover:translate-x-0.5" />
</a>

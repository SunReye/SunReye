<!-- A sheet's way onward: History at the sheet's range and figure. -->
<script lang="ts">
  import { m } from "../paraglide/messages.js";
  import { rangeParams } from "../range/params.ts";
  import type { RangeRoute } from "../range/route.svelte.ts";
  import OnwardLink from "./OnwardLink.svelte";
  import type { Onward } from "./sheets.ts";

  let { route, onward }: { route: RangeRoute; onward: Onward } = $props();

  const href = $derived.by(() => {
    const query = Object.entries({
      ...rangeParams(route.place.cal, route.range),
      ...onward,
    }).filter((e): e is [string, string] => e[1] !== null);

    return `#/history?${new URLSearchParams(query).toString()}`;
  });
</script>

<OnwardLink {href}>{m.detail_history({ range: route.label })}</OnwardLink>

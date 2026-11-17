<!-- A sheet's way onward: History at the sheet's range and figure. -->
<script lang="ts">
  import { m } from "../paraglide/messages.js";
  import { rangeParams } from "../range/params.ts";
  import type { RangeRoute } from "../range/route.svelte.ts";
  import { figureView } from "../history/view.ts";
  import OnwardLink from "./OnwardLink.svelte";

  let { route, id }: { route: RangeRoute; id: string } = $props();

  const href = $derived.by(() => {
    const query = Object.entries({
      ...rangeParams(route.place.cal, route.range),
      ...figureView(id),
    }).filter((e): e is [string, string] => e[1] !== null);

    return `#/history?${new URLSearchParams(query).toString()}`;
  });
</script>

<OnwardLink {href}>{m.detail_history({ range: route.label })}</OnwardLink>

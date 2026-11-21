<!-- The savings sheet's way to the tariff, at the sheet's range (ADR 21). -->
<script lang="ts">
  import TextLink from "../components/text-link.svelte";
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

<TextLink {href} onward class="self-start text-sm">{m.detail_tariff_link()}</TextLink>

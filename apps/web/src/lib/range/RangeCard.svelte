<!-- A card over the range: a finger anywhere on it but its chart steps the range (ADR 21). -->
<script lang="ts">
  import type { Snippet } from "svelte";
  import * as Card from "#lib/components/ui/card/index.js";
  import type { Ranged } from "./range.ts";
  import { swipe } from "./swipe.ts";

  let { model, children }: { model: Pick<Ranged, "step">; children: Snippet } = $props();
</script>

<Card.Root class="glass-ambient @container gap-0 py-0" {@attach swipe(model.step)}>
  <div class="flex flex-col gap-4 px-3 pt-4 pb-4 sm:px-5">
    {@render children()}
  </div>
</Card.Root>

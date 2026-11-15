<!--
  A card over the range: a finger anywhere on it but its chart steps the range (ADR 21). It stages
  itself.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import * as Card from "#lib/components/ui/card/index.js";
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";
  import Staged from "../motion/Staged.svelte";
  import type { Ranged } from "./range.ts";
  import { swipe } from "./swipe.ts";

  let { model, children }: { model: Ranged; children: Snippet } = $props();
</script>

<!-- In a frame after its screen's: a screen's cards at once overrun a route change's (ADR 21). -->
<Staged>
  {#snippet skeleton()}<Skeleton class="h-[420px] rounded-lg" />{/snippet}
  <Card.Root class="glass-ambient @container gap-0 py-0" {@attach swipe(model.step)}>
    <div class="flex flex-col gap-4 px-3 pt-4 pb-4 sm:px-5">
      {@render children()}
    </div>
  </Card.Root>
</Staged>

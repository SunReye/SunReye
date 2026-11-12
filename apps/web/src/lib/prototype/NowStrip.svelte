<script lang="ts">
  import * as Card from "#lib/components/ui/card/index.js";
  import { Badge } from "#lib/components/ui/badge/index.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import AnimatedNumber from "./AnimatedNumber.svelte";
  import type { LiveSim } from "./sim.svelte";
  let { sim, onopen }: { sim: LiveSim; onopen: (id: string) => void } = $props();
</script>

<!-- Summary figures in one strip divided by a hairline. -->
<Card.Root size="sm" class="glass-ambient py-1">
  <dl class="grid grid-cols-2 divide-x divide-border/60 px-1">
    <Button variant="ghost" class="h-auto flex-col items-start gap-1 px-3 py-2" onclick={() => onopen("price")}>
      <dt class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        Spotpreis jetzt <Badge variant="outline" class="text-export">günstig</Badge>
      </dt>
      <dd class="text-lg leading-none font-semibold tracking-tight"><AnimatedNumber value={sim.price} /> <span class="text-xs font-medium text-muted-foreground">ct/kWh</span></dd>
    </Button>
    <Button variant="ghost" class="h-auto flex-col items-start gap-1 px-3 py-2" onclick={() => onopen("forecast")}>
      <dt class="text-xs font-medium text-muted-foreground">PV noch erwartet heute</dt>
      <dd class="text-lg leading-none font-semibold tracking-tight"><AnimatedNumber value={sim.remaining} /> <span class="text-xs font-medium text-muted-foreground">kWh</span></dd>
    </Button>
  </dl>
</Card.Root>

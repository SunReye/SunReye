<!-- The tariff form's submits, on a card that stays in reach above the bar however long the bands run. -->
<script lang="ts">
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Card from "#lib/components/ui/card/index.js";
  import { m } from "../paraglide/messages.js";

  /** Whether a date to reprice from is set. */
  let { dated }: { dated: boolean } = $props();
</script>

<Card.Root
  class="glass-ambient sticky bottom-[calc(var(--bar-clear,0px)+0.75rem)] z-10 mx-2 mt-4 flex-row items-center gap-2 p-2"
>
  <Button
    type="submit"
    variant="ghost"
    name="reprice"
    disabled={!dated}
    class="h-auto min-h-9 min-w-0 flex-1 justify-start text-left whitespace-normal"
  >
    {m.tariff_reprice()}
  </Button>
  <Button type="submit">{m.tariff_save()}</Button>
</Card.Root>

<!-- What the investment has earned back so far and what is still open, as label and value rows. -->
<script lang="ts">
  import type { Payback } from "../api/tariff";
  import { m } from "../paraglide/messages.js";
  import { euros } from "./format";

  let { payback }: { payback: Payback } = $props();
</script>

<dl class="flex flex-col divide-y divide-border/60">
  <div class="flex items-baseline justify-between gap-3 px-4 py-3 text-[15px]">
    <dt>{m.tariff_savings()}</dt>
    <dd class="font-medium tabular-nums">{euros(payback.savings)}</dd>
  </div>
  <div class="flex items-baseline justify-between gap-3 px-4 py-3 text-[15px]">
    <dt>{m.tariff_remaining()}</dt>
    <dd class="font-medium tabular-nums">
      {payback.remaining == null ? "–" : euros(payback.remaining)}
    </dd>
  </div>
</dl>

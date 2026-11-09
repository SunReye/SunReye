<script lang="ts">
  import type { Payback } from "../api/tariff";
  import { m } from "../paraglide/messages.js";
  import { euros } from "./format";

  let { payback }: { payback: Payback } = $props();
</script>

<dl>
  <div>
    <dt>{m.tariff_investment()}</dt>
    <dd>{payback.investment == null ? "–" : euros(payback.investment)}</dd>
  </div>
  <div>
    <dt>{m.tariff_savings()}</dt>
    <dd>{euros(payback.savings)}</dd>
  </div>
  <div>
    <dt>{m.tariff_remaining()}</dt>
    <dd>{payback.remaining == null ? "–" : euros(payback.remaining)}</dd>
  </div>
</dl>

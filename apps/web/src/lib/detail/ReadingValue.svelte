<!-- One reading's value: words for a status, else the number in its unit; "≈" on an estimate. -->
<script lang="ts">
  import AnimatedNumber from "../components/animated-number.svelte";
  import { m } from "../paraglide/messages.js";
  import type { Row } from "./rows.ts";

  let { row, loading, dim }: { row: Row; loading: boolean; dim: boolean } = $props();

  const value = $derived(loading ? null : (row.value ?? null));
</script>

<span class={["whitespace-nowrap", dim && "opacity-60"]}>
  {#if row.text !== undefined}
    <span class="font-semibold">{loading ? "–" : row.text}</span>
  {:else}
    {#if row.est}<span
        class="me-1 font-normal text-muted-foreground"
        title={m.detail_estimated()}
        aria-label={m.detail_estimated()}>≈</span
      >{/if}<span class="font-semibold"><AnimatedNumber {value} digits={row.digits} /></span
    >{#if row.unit}<span class="ms-1 text-muted-foreground">{row.unit}</span>{/if}
  {/if}
</span>

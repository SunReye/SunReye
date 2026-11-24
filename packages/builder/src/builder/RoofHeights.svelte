<!--
  The tracing bar without a picked line (ADR 20): what to do, and the traced roof's eave and ridge
  heights, which pull it up.
-->
<script lang="ts">
  import { m } from "../paraglide/messages.js";
  import HeightButton from "./HeightButton.svelte";
  import type { TracingMode } from "./tracing-mode.svelte.ts";

  let { mode }: { mode: TracingMode } = $props();
</script>

<p class="min-w-0 basis-full text-sm text-pretty text-muted-foreground">
  {m.builder_trace_hint()}
</p>
{#if mode.block !== undefined}
  <HeightButton
    name={m.builder_trace_eaves()}
    value={mode.heightOf("eave")}
    onchange={(height) => {
      mode.pull("eave", height);
    }}
  />
  <HeightButton
    name={m.builder_trace_ridges()}
    value={mode.heightOf("ridge")}
    onchange={(height) => {
      mode.pull("ridge", height);
    }}
  />
{/if}

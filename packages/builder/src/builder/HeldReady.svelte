<!--
  A ready shape held on the tracing bar (ADR 20): where the next tap places it, and letting go.
-->
<script lang="ts">
  import { readyDormers, readyRoofs } from "@sunreye/scene";
  import { Button } from "@sunreye/ui/button";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";
  import type { Placing } from "./tracing.svelte.ts";
  import type { TracingMode } from "./tracing-mode.svelte.ts";

  let { mode, placing }: { mode: TracingMode; placing: Placing } = $props();

  const entry = $derived(
    (placing.kind === "roof" ? readyRoofs : readyDormers).find((e) => e.id === placing.id),
  );

  const name = $derived((getLocale() === "de" ? entry?.de : entry?.en) ?? placing.id);
</script>

<p role="status" class="min-w-0 flex-1 text-sm text-pretty">
  {placing.kind === "roof"
    ? m.builder_trace_place_roof({ name })
    : m.builder_trace_place_dormer({ name })}
</p>
<Button
  variant="ghost"
  size="sm"
  onclick={() => {
    mode.hold();
  }}
>
  {m.builder_trace_cancel()}
</Button>

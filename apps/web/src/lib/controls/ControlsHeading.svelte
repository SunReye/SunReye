<!--
  Controls' title, and the read-only banner while a device's writes switch is off (ADR 21). A group's
  page on the phone has its own header, so there the banner stands alone.
-->
<script lang="ts">
  import PageTitle from "../components/page-title.svelte";
  import Lock from "@lucide/svelte/icons/lock";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import { Button } from "@sunreye/ui/button";
  import { m } from "../paraglide/messages.js";

  let { writes, title = true }: { writes: boolean; title?: boolean } = $props();
</script>

{#if title}
  <header class="flex items-end justify-between gap-4 px-1">
    <PageTitle title={m.controls_title()} />
    {#if writes}
      <!-- The normal state stays quiet; the exception below gets the weight. -->
      <span class="flex items-center gap-1.5 pb-1 text-xs text-muted-foreground"
        ><ShieldCheck class="size-3.5 text-success" /> {m.controls_writes_on()}</span
      >
    {/if}
  </header>
{/if}

{#if !writes}
  <div
    class="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm"
    role="status"
  >
    <Lock class="mt-0.5 size-4 shrink-0 text-warning" />
    <p class="min-w-[200px] flex-1">
      <span class="font-medium">{m.controls_read_only()}</span>
      <span class="text-muted-foreground">{m.controls_writes_off()}</span>
    </p>
    <Button variant="outline" size="sm" class="ml-7 shrink-0" href="#/settings?group=writes"
      >{m.controls_to_writes()}</Button
    >
  </div>
{/if}

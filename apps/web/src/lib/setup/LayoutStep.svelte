<!--
  Setup's PV layout step (ADR 20, 21): the 3D builder fills the screen under the setup's progress and
  back. "Done" always carries on, a layout saved or not: without 3D it is the only way on.
-->
<script lang="ts">
  import GlassCard from "../components/glass-card.svelte";
  // The glue crate's release build, which the SPA build makes first (ADR 2, 20).
  import wasm from "../../../../../target/wasm32-unknown-unknown/release/sunreye_pv_wasm.wasm?url";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import type { Core, Device } from "../api/core.ts";
  import { emptyDraft } from "../builder/modules";
  import { loadPv } from "../builder/pv";
  import { Button } from "#lib/components/ui/button/index.js";
  import { m } from "../paraglide/messages.js";

  let {
    core,
    devices,
    step,
    count,
    onback,
    ondone,
  }: {
    core: Core;
    devices: readonly Device[];
    step: number;
    count: number;
    onback: () => void;
    ondone: () => void;
  } = $props();

  const webgl2 = document.createElement("canvas").getContext("webgl2") !== null;

  /** The builder, its crate and the module types; the first run starts from an empty layout. */
  async function load() {
    const [{ default: Builder }, pv, moduleTypes] = await Promise.all([
      // Lazy, so three.js loads up front only on the builder route (ADR 20).
      import("../builder/Builder.svelte"),
      fetch(wasm).then(async (response) => loadPv(new Uint8Array(await response.arrayBuffer()))),
      core.moduleTypes(),
    ]);

    return { Builder, pv, moduleTypes: "problem" in moduleTypes ? [] : moduleTypes };
  }
</script>

<main class="flex h-dvh flex-col">
  <!-- On a phone back keeps only its chevron, so the title shows whole or wraps. -->
  <header
    class="glass-ambient flex items-center gap-2 border-b border-border/60 py-1.5 pr-3 pl-1.5"
  >
    <Button variant="ghost" size="sm" onclick={onback} class="shrink-0 text-brand">
      <ChevronLeft data-icon="inline-start" />
      <span class="max-sm:sr-only">{m.setup_title()}</span>
    </Button>
    <div class="flex min-w-0 flex-1 flex-col leading-tight">
      <h2 class="text-[15px] font-semibold text-balance break-words">{m.layout_title()}</h2>
      <span class="text-xs text-muted-foreground tabular-nums">
        {m.setup_progress({ step, count })}
      </span>
    </div>
    <Button class="shrink-0" onclick={ondone}>{m.setup_finish()}</Button>
  </header>
  <!-- The builder sizes itself to the screen; here it takes what the header leaves. -->
  <div class="min-h-0 flex-1 [&>div]:h-full">
    {#if webgl2}
      {#await load()}
        <p role="status" class="p-6 text-sm text-muted-foreground">{m.builder_loading()}</p>
      {:then { Builder, pv, moduleTypes }}
        <Builder {pv} {core} start={emptyDraft()} {moduleTypes} {devices} />
      {/await}
    {:else}
      <div class="grid h-full place-items-center p-4">
        <GlassCard class="flex max-w-sm flex-col gap-2 p-4 text-sm">
          <p class="font-medium">{m.builder_no_webgl()}</p>
          <p class="text-muted-foreground">{m.layout_later()}</p>
        </GlassCard>
      </div>
    {/if}
  </div>
</main>

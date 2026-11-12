<!--
  Setup's PV layout step (ADR 20, 21): the 3D builder fills the screen under the setup's progress and
  back. "Done" always carries on, a layout saved or not: without 3D it is the only way on.
-->
<script lang="ts">
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
  <header
    class="glass-ambient flex items-center gap-2 border-b border-border/60 py-1.5 pr-3 pl-1.5"
  >
    <Button variant="ghost" size="sm" onclick={onback} class="text-brand">
      <ChevronLeft data-icon="inline-start" />
      {m.setup_title()}
    </Button>
    <div class="flex min-w-0 flex-col leading-tight">
      <h2 class="truncate text-[15px] font-semibold">{m.layout_title()}</h2>
      <span class="text-xs text-muted-foreground tabular-nums">
        {m.setup_progress({ step, count })}
      </span>
    </div>
    <Button class="ml-auto" onclick={ondone}>{m.setup_finish()}</Button>
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
        <div
          class="glass-ambient flex max-w-sm flex-col gap-2 rounded-lg border border-border/60 p-4 text-sm elevation-1"
        >
          <p class="font-medium">{m.builder_no_webgl()}</p>
          <p class="text-muted-foreground">{m.layout_later()}</p>
        </div>
      </div>
    {/if}
  </div>
</main>

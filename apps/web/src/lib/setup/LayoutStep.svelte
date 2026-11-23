<!--
  Setup's PV layout step (ADR 20, 21): the 3D builder fills the screen under the setup's progress and
  back. "Done" always carries on, a layout saved or not: without 3D it is the only way on.
-->
<script lang="ts">
  import * as Card from "@sunreye/ui/card";
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";
  import { DrillHeader } from "@sunreye/builder/controls";
  // The glue crate's release build, which the SPA build makes first (ADR 2, 20).
  import type { Core, Device } from "../api/core.ts";
  import { homeBuilder } from "../builder/host.ts";
  import { fetchPv } from "../builder/engine.ts";
  import { stream } from "../live/stream.svelte.ts";
  import { Button } from "@sunreye/ui/button";
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

  // Setup shows no shell, whose layout follows the stream elsewhere: the builder's cars need it.
  $effect(() => stream.follow(core));

  const webgl2 = document.createElement("canvas").getContext("webgl2") !== null;

  /** The builder, its crate and the module types; the first run starts from an empty layout. */
  async function load() {
    const [{ Builder, emptyDraft }, pv, moduleTypes] = await Promise.all([
      // Lazy, so three.js loads up front only on the builder route (ADR 20).
      import("@sunreye/builder"),
      fetchPv(),
      core.moduleTypes(),
    ]);

    return {
      Builder,
      start: emptyDraft(),
      pv,
      moduleTypes: "problem" in moduleTypes ? [] : moduleTypes,
    };
  }
</script>

<main class="flex h-dvh flex-col">
  <DrillHeader
    back={m.setup_title()}
    title={m.layout_title()}
    sub={m.setup_progress({ step, count })}
    {onback}
    class="glass-ambient"
  >
    {#snippet action()}
      <Button onclick={ondone}>{m.setup_finish()}</Button>
    {/snippet}
  </DrillHeader>
  <!-- The builder sizes itself to the screen; here it takes what the header leaves. -->
  <div class="min-h-0 flex-1 [&>div]:h-full">
    {#if webgl2}
      {#await load()}
        <Skeleton class="rounded-none" role="status" aria-label={m.builder_loading()} />
      {:then { Builder, start, pv, moduleTypes }}
        <Builder {pv} {core} {...homeBuilder(core)} {start} {moduleTypes} {devices} />
      {/await}
    {:else}
      <div class="grid h-full place-items-center p-4">
        <Card.Root class="max-w-sm gap-2 p-4">
          <p class="font-medium">{m.builder_no_webgl()}</p>
          <p class="text-muted-foreground">{m.layout_later()}</p>
        </Card.Root>
      </div>
    {/if}
  </div>
</main>

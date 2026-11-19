<!--
  The scene's readout (ADR 21 "Measuring"), shown when the URL asks with `?perf`: what a frame
  draws and what this browser draws with, sampled twice a second, over switches that try a
  lighter drawing on this page. No blur: it lies over the canvas it measures.
-->
<script lang="ts">
  import { Toggle } from "#lib/components/ui/toggle/index.js";
  import * as ToggleGroup from "#lib/components/ui/toggle-group/index.js";
  import { read } from "../kept.ts";
  import { motion } from "../motion/tier.svelte.ts";
  import { m } from "../paraglide/messages.js";
  import { readout } from "./perf-lines.ts";
  import { perf } from "./perf.svelte.ts";
  import { quality } from "./quality.svelte.ts";
  import { gpuOf } from "./quality.ts";

  const RATIOS = ["1", "1.5", "2", "3"] as const;

  const MAPS = ["1024", "2048", "4096"] as const;

  /** Milliseconds between two readings: often enough to follow, too seldom to cost a frame. */
  const EVERY = 500;

  let lines = $state.raw<readonly string[]>([]);

  // The URL may have changed since the module read it.
  perf.read();

  const studio = $derived(perf.on ? perf.studio : undefined);

  $effect(() => {
    if (studio === undefined) return;

    const measured = studio;
    const probe = measured.measure();

    const sample = (): void => {
      lines = readout({
        frame: probe.last,
        fps: probe.fps,
        gpu: probe.gpu,
        pixelRatio: measured.pixelRatio,
        shadowMap: measured.shadowMap,
        occlusion: measured.occlusion,
        contact: measured.look.contact,
        quality: quality.choice,
        level: measured.look.level,
        tier: motion.tier,
        looping: motion.looping,
        renderer: gpuOf(measured.renderer.getContext()),
        strains: {
          drawing: read("sunreye.3d-strain"),
          motion: read("sunreye.motion-strain"),
          at: read("sunreye.strained-at"),
        },
      });
    };

    sample();

    const timer = setInterval(sample, EVERY);

    return () => {
      clearInterval(timer);
    };
  });

  /** A switch is pressed until it turns its part off. */
  function turn(part: "occlusion" | "contact", on: boolean): void {
    const { [part]: _, ...rest } = perf.trial;

    perf.trial = on ? rest : { ...rest, [part]: false };
  }

  /** A number picked is tried; picked again, the look's own is drawn. */
  function pick(part: "pixelRatio" | "shadowMap", value: string): void {
    const { [part]: _, ...rest } = perf.trial;

    perf.trial = value === "" ? rest : { ...rest, [part]: Number(value) };
  }
</script>

<svelte:window onhashchange={() => perf.read()} />

{#if studio !== undefined}
  <div
    class="pointer-events-none absolute top-14 left-2 z-20 flex max-w-[calc(100%-1rem)] flex-col gap-1.5 rounded-md bg-card/90 p-2 font-mono text-[10px] leading-tight text-card-foreground ring-1 ring-border/60"
  >
    <output aria-label={m.perf_readout()} class="whitespace-pre-wrap">{lines.join("\n")}</output>
    <div class="pointer-events-auto flex flex-wrap items-center gap-1">
      <Toggle
        size="sm"
        variant="outline"
        class="h-6 px-1.5 text-[10px]"
        aria-label={m.perf_occlusion()}
        bind:pressed={() => perf.trial.occlusion !== false, (on) => turn("occlusion", on)}
      >
        AO
      </Toggle>
      <Toggle
        size="sm"
        variant="outline"
        class="h-6 px-1.5 text-[10px]"
        aria-label={m.perf_contact()}
        bind:pressed={() => perf.trial.contact !== false, (on) => turn("contact", on)}
      >
        PCSS
      </Toggle>
      <ToggleGroup.Root
        type="single"
        size="sm"
        variant="outline"
        aria-label={m.perf_ratio()}
        bind:value={
          () => String(perf.trial.pixelRatio ?? ""), (value) => pick("pixelRatio", value)
        }
      >
        {#each RATIOS as ratio (ratio)}
          <ToggleGroup.Item value={ratio} class="h-6 px-1.5 text-[10px]">{ratio}</ToggleGroup.Item>
        {/each}
      </ToggleGroup.Root>
      <ToggleGroup.Root
        type="single"
        size="sm"
        variant="outline"
        aria-label={m.perf_shadow_map()}
        bind:value={() => String(perf.trial.shadowMap ?? ""), (value) => pick("shadowMap", value)}
      >
        {#each MAPS as map (map)}
          <ToggleGroup.Item value={map} class="h-6 px-1.5 text-[10px]">{map}</ToggleGroup.Item>
        {/each}
      </ToggleGroup.Root>
    </div>
  </div>
{/if}

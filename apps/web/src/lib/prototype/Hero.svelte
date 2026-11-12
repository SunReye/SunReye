<!--
  PROTOTYPE: the hero: the 3D scene or the 2D flow, the toggle in its corner (ADR 21), and the one
  figure the dashboard leads with. The headline names what the plant is doing now, so at night it
  switches from production to consumption instead of showing a zero.

  The dashboard is usable before the 3D scene exists: three.js and the scene are imported once the
  page has painted and gone idle, the hero holds the scene's place meanwhile, and the scene fades
  in when its first frame is on screen. In 2D, under the low-power switch or without WebGL2,
  three.js is never loaded; a failed load leaves the 2D flow with a note.
-->
<script lang="ts">
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import Unplug from "@lucide/svelte/icons/unplug";
  import Box from "@lucide/svelte/icons/box";
  import * as ToggleGroup from "#lib/components/ui/toggle-group/index.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import { untrack } from "svelte";
  import type Scene3d from "./Scene3d.svelte";
  import SceneStandIn from "./SceneStandIn.svelte";
  import Flow2d from "./flow/Flow2d.svelte";
  import { rememberedWebgl2, rememberWebgl2, warm } from "./scene/warm";
  import { motion } from "./motion/tier.svelte";
  import AnimatedNumber from "./AnimatedNumber.svelte";
  import type { LiveSim } from "./sim.svelte";
  import type { Screen } from "./nav";
  import { haptics } from "./haptics";
  import { view, setHero } from "./view.svelte";

  let {
    sim,
    dark,
    tod,
    onselect,
    onnavigate,
    class: className = "",
  }: {
    sim: LiveSim;
    dark: boolean;
    tod: string;
    onselect: (id: string) => void;
    onnavigate?: (id: Screen) => void;
    class?: string;
  } = $props();

  // The 2D flow serves without a built scene, without WebGL2 and under the low-power switch (ADR 20).
  let webgl2 = $state(rememberedWebgl2());
  const can3d = $derived(sim.has.scene && webgl2 && !view.lowPower && view.scene3d !== "nogl");
  const want3d = $derived(can3d && view.hero === "3d");

  let Scene = $state.raw<typeof Scene3d | null>(null);
  let stage = $state<"loading" | "ready" | "failed">("loading");
  /** What the scene fades in over: the studio stand-in on a first visit, the flow it replaces after a switch. */
  let under = $state<"standin" | "flow" | "none">("standin");
  /** Loading has taken longer than a second: say so. */
  let slow = $state(false);
  let attempt = $state(0);
  let settle: ReturnType<typeof setTimeout> | undefined;

  const failed = $derived(want3d && stage === "failed");
  const flowShown = $derived(!want3d || failed || under === "flow");
  const mode = $derived(want3d && !failed ? "3d" : "2d");

  function set(m: string): void {
    if (!m || m === mode) return;
    haptics.selection();
    // The preference is still 3D after a failed load: asking again retries.
    if (m === "3d" && failed) attempt += 1;
    else setHero(m as "3d" | "2d");
  }

  // Load the scene whenever 3D becomes what is wanted. An effect, because the wish changes from
  // outside too: the dev bar, the low-power switch.
  let first = true;
  $effect(() => {
    void attempt;
    if (!want3d) return;
    return untrack(() => {
      stage = "loading";
      slow = false;
      under = first ? "standin" : "flow";
      first = false;
      let cancelled = false;
      const slowTimer = setTimeout(() => (slow = true), 1000);
      const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 200));
      // After the dashboard has painted and the main thread has nothing better to do.
      requestAnimationFrame(() =>
        idle(
          async () => {
            if (cancelled || view.scene3d === "hold") return;
            try {
              if (view.scene3d === "fail") throw new Error("simulated");
              // The worker answers before three.js is asked for; when it cannot tell, the renderer will.
              if ((await warm().webgl2) === false) {
                webgl2 = false;
                return;
              }
              const mod = await import("./Scene3d.svelte");
              if (!cancelled) Scene = mod.default;
            } catch {
              if (!cancelled) stage = "failed";
            }
          },
          { timeout: 1500 },
        ),
      );
      return () => {
        cancelled = true;
        clearTimeout(slowTimer);
        clearTimeout(settle);
      };
    });
  });
  // The other way round needs no load: the flow is simply shown again.
  $effect(() => {
    if (!want3d) first = false;
  });

  function fail(reason: unknown): void {
    if (reason === "webgl2") {
      // Not an error: this browser cannot draw the scene, so the flow is the dashboard.
      rememberWebgl2(false);
      webgl2 = false;
    } else stage = "failed";
  }

  function ready(): void {
    stage = "ready";
    // What was underneath goes once the fade has covered it.
    settle = setTimeout(() => (under = "none"), motion.still ? 0 : 400);
  }

  const loading = $derived(sim.status === "loading");
  const producing = $derived(loading || sim.pv > 0.05);
  const subject = $derived(producing ? "Erzeugung" : "Verbrauch");
  const lead = $derived(loading ? null : producing ? sim.pv : sim.house + sim.ev);
  const exporting = $derived(sim.grid < 0);
  const age = $derived(sim.age < 90 ? `${sim.age} s` : `${Math.round(sim.age / 60)} min`);

  let headH = $state(0);
  const figure = "rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";
</script>

<section class="relative isolate {className}" aria-label="Anlage live">
  {#if flowShown}
    <Flow2d {sim} {onselect} top={headH + 12} />
  {/if}
  {#if mode === "3d"}
    {#if under === "standin"}
      <SceneStandIn {dark} slow={slow && stage === "loading"} />
    {/if}
    {#if Scene}
      <Scene {sim} {dark} {tod} {onselect} onready={ready} onerror={fail} />
    {/if}
  {/if}

  <div class="pointer-events-none absolute top-0 left-0 flex max-w-[calc(100%-7.5rem)] flex-col p-4" bind:clientHeight={headH}>
    <!-- The label stops claiming "now" the moment the stream does (ADR 21: the chip shows the stall). -->
    {#if sim.status === "stalled"}
      <span class="flex items-center gap-1.5 text-xs font-medium text-warning" role="status"><TriangleAlert class="size-3.5 shrink-0" />{subject} · keine Daten seit {age}</span>
    {:else if sim.status === "error"}
      <span class="flex items-center gap-1.5 text-xs font-medium text-destructive" role="alert"><Unplug class="size-3.5 shrink-0" />{subject} · Verbindung getrennt</span>
    {:else if loading}
      <span class="text-xs font-medium text-muted-foreground" role="status">Verbinde mit der Anlage …</span>
    {:else}
      <span class="text-xs font-medium text-muted-foreground">{subject} jetzt</span>
    {/if}
    <span class={["text-gradient text-5xl leading-[1.1] font-semibold tracking-tight", sim.status !== "live" && !loading && "opacity-60"]}>
      <AnimatedNumber value={lead} /> <span class="text-2xl text-muted-foreground">kW</span>
    </span>
    {#if !flowShown && !loading}
      <!-- What the scene's chips do not carry: the house and the grid. Each opens its detail sheet, as a flow node does. -->
      <span class="pointer-events-auto mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted-foreground">
        {#if producing}
          <button type="button" class={figure} onclick={() => onselect("house")}>Haus <span class="font-semibold text-foreground"><AnimatedNumber value={sim.house} /></span> kW</button>
        {:else if sim.has.battery}
          <button type="button" class={figure} onclick={() => onselect("battery")}>Batterie <span class="font-semibold text-battery"><AnimatedNumber value={Math.abs(sim.battery)} /></span> kW</button>
        {/if}
        <button type="button" class={figure} onclick={() => onselect("grid")}>
          {exporting ? "Einspeisung" : "Bezug"}
          <span class={["font-semibold", exporting ? "text-export" : "text-import"]}><AnimatedNumber value={Math.abs(sim.grid)} /></span> kW
        </button>
      </span>
    {/if}
    {#if failed}
      <!-- Quiet, beside the figure it does not change: the flow below is the dashboard, not an error. -->
      <span class="pointer-events-auto mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground" role="status">
        3D-Ansicht nicht geladen
        <button type="button" class="rounded-sm font-medium text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring" onclick={() => (attempt += 1)}>Erneut versuchen</button>
      </span>
    {/if}
    {#if sim.status === "error"}
      <Button variant="outline" size="sm" class="pointer-events-auto mt-2 self-start" onclick={() => sim.resume()}>Neu verbinden</Button>
    {/if}
  </div>

  {#if can3d}
    <ToggleGroup.Root
      type="single"
      size="sm"
      spacing={1}
      bind:value={() => mode, set}
      class="glass-ambient absolute top-3 right-3 z-10 rounded-md p-0.5 ring-1 ring-border/60 elevation-1"
      aria-label="Ansicht"
    >
      <ToggleGroup.Item value="3d" class="px-3 text-xs">3D</ToggleGroup.Item>
      <ToggleGroup.Item value="2d" class="px-3 text-xs">2D</ToggleGroup.Item>
    </ToggleGroup.Root>
  {:else if !sim.has.scene}
    <Button variant="outline" size="sm" class="glass-ambient absolute top-3 right-3 z-10" onclick={() => onnavigate?.("builder")}>
      <Box data-icon="inline-start" /> 3D-Haus bauen
    </Button>
  {/if}
</section>

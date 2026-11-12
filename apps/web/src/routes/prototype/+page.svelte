<!--
  PROTOTYPE (throwaway, branch prototype/look-feel): "Does ADR 21's look and feel match what I imagined?"
  Three dashboard variants on #/prototype?variant=A|B|C; shared shell, sheets, controls and value editor.
  Optional params: tod=dawn|noon|dusk|night, theme=light|dark, screen=<nav id>, drill=<group>, p=<0..1>, rail=open.
-->
<script lang="ts">
  import "../../app.css";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { untrack } from "svelte";
  import { Toaster } from "#lib/components/ui/sonner/index.js";
  import { LiveSim } from "#lib/prototype/sim.svelte";
  import Shell from "#lib/prototype/Shell.svelte";
  import Switcher from "#lib/prototype/Switcher.svelte";
  import DetailSheet from "#lib/prototype/DetailSheet.svelte";
  import Controls from "#lib/prototype/Controls.svelte";
  import SecondaryScreen from "#lib/prototype/SecondaryScreen.svelte";
  import VariantA, { name as nameA } from "#lib/prototype/VariantA.svelte";
  import VariantB, { name as nameB } from "#lib/prototype/VariantB.svelte";
  import VariantC, { name as nameC } from "#lib/prototype/VariantC.svelte";
  import type { Screen } from "#lib/prototype/nav";
  import { input } from "#lib/prototype/input.svelte";
  import { view } from "#lib/prototype/view.svelte.js";

  const VARIANTS = { A: VariantA, B: VariantB, C: VariantC };
  const NAMES = { A: nameA, B: nameB, C: nameC };
  type Key = keyof typeof VARIANTS;

  // The hash router keeps the query inside the hash: #/prototype?variant=B.
  const params = $derived(new URLSearchParams(page.url.hash.split("?")[1] ?? ""));
  const variant = $derived((params.get("variant")?.toUpperCase() ?? "A") in VARIANTS ? ((params.get("variant")?.toUpperCase() ?? "A") as Key) : "A");
  const Variant = $derived(VARIANTS[variant]);

  function setParam(k: string, v: string): void {
    const next = new URLSearchParams(params);
    next.set(k, v);
    void goto(`#/prototype?${next}`, { replace: true, reset: false });
  }

  // The 3D scene's backdrop and the low-power switch (skips the AO pass), from the URL.
  $effect(() => {
    view.scene = params.get("scene") === "sky" ? "sky" : "studio";
    view.lowPower = params.get("lowPower") === "1";
  });

  const sim = new LiveSim();
  $effect(() => sim.start());

  let tod = $state(untrack(() => params.get("tod")) ?? "noon");
  if (typeof document !== "undefined") document.documentElement.dataset.tod = untrack(() => tod);
  $effect(() => {
    document.documentElement.dataset.tod = tod;
  });
  // Dark by default, designed dark-first (ADR 21); a manual override is kept per browser.
  const queryTheme = untrack(() => params.get("theme"));
  let dark = $state(
    queryTheme ? queryTheme !== "light" : typeof localStorage === "undefined" || localStorage.getItem("proto.theme") !== "light",
  );
  function setDark(d: boolean): void {
    dark = d;
    localStorage.setItem("proto.theme", d ? "dark" : "light");
  }
  if (typeof document !== "undefined") document.documentElement.dataset.theme = "graphite";
  function applyDark(d: boolean): void {
    document.documentElement.classList.toggle("dark", d);
    document.documentElement.style.colorScheme = d ? "dark" : "light";
  }
  // Before children mount, so the 3D scene reads the right page colours.
  if (typeof document !== "undefined") applyDark(untrack(() => dark));
  $effect(() => {
    applyDark(dark);
  });


  let screen = $state<Screen>((untrack(() => params.get("screen")) as Screen) ?? "dashboard");
  let detail = $state<string | null>(untrack(() => params.get("detail")));
  const drill = untrack(() => params.get("drill"));
  const drillP = untrack(() => params.get("p"));
  const railOpen = untrack(() => params.get("rail")) === "open";
</script>

<svelte:head><title>SunReye · Prototyp</title></svelte:head>


<!-- Backdrop: only the sun-tinted spotlight under the glass. -->
<div class="pointer-events-none fixed inset-0 -z-10 bg-background" aria-hidden="true">
  <div class="absolute inset-0 bg-spotlight"></div>
</div>

<Shell bind:screen forceExpanded={railOpen}>
  {#key screen}
    <main class="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-200">
      {#if screen === "dashboard"}
        <Variant {sim} {dark} {tod} onopen={(id: string) => (detail = id)} />
      {:else if screen === "controls"}
        <Controls initial={drill} initialProgress={drillP ? Number(drillP) : undefined} />
      {:else}
        <SecondaryScreen {screen} {sim} />
      {/if}
    </main>
  {/key}
</Shell>

<DetailSheet
  bind:id={detail}
  {sim}
  onhistory={() => {
    detail = null;
    screen = "history";
  }}
/>

<Toaster theme={dark ? "dark" : "light"} position={input.shell === "bar" ? "top-center" : "bottom-right"} />

{#if import.meta.env.DEV}
  <Switcher
    keys={Object.keys(VARIANTS)}
    names={NAMES}
    current={variant}
    onvariant={(k) => setParam("variant", k)}
    {tod}
    ontod={(t) => (tod = t)}
    {dark}
    ondark={setDark}
    scene={view.scene}
    onscene={(m) => setParam("scene", m)}
  />
{/if}

<!--
  PROTOTYPE (throwaway, branch prototype/look-feel): ADR 21's look, feel and navigation.
  #/prototype?…  theme=light|dark, tod=dawn|noon|dusk|night (night also switches the plant to a night
  reading), screen=<nav id>, detail=<key of details.ts>, drill=<group>, p=<0..1>, rail=open,
  scene=studio|sky, lowPower=1, tier=full|lite|still, dev=open, scene3d=fail|hold|nogl (the 3D load's states).
  States: state=loading|stalled|error, no=battery,ev,scene, strings=1..6, long=1, writes=off,
  missing=<role>,… (a role the profile does not map, e.g. pv.mppt.voltage), stale=<role>,… , offline=inverter|battery|meter|ev.
  Statistics (screen=history): range=day|week|month|year|custom, at=<date>, from/to=<date>, metric=energy|money|autarky|plant,
  tab=time|years|pattern|forecast|tariff|payback|strings|battery|data, cmp=prev|year, sid=<string id>, stats=loading|error|new, long=1.
-->
<script lang="ts">
  import "../../app.css";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { untrack } from "svelte";
  import { Toaster } from "#lib/components/ui/sonner/index.js";
  import { LiveSim, type DeviceId, type StreamStatus } from "#lib/prototype/sim.svelte";
  import Shell from "#lib/prototype/Shell.svelte";
  import DevBar from "#lib/prototype/DevBar.svelte";
  import DetailSheet from "#lib/prototype/DetailSheet.svelte";
  import Controls from "#lib/prototype/Controls.svelte";
  import SecondaryScreen from "#lib/prototype/SecondaryScreen.svelte";
  import Statistics from "#lib/prototype/stats/Statistics.svelte";
  import { buildHistory } from "#lib/prototype/stats/history";
  import type { Sel } from "#lib/prototype/stats/query";
  import { detailView, selParams, STATS_PARAMS } from "#lib/prototype/stats/route";
  import Dashboard from "#lib/prototype/Dashboard.svelte";
  import { NAV, type Screen } from "#lib/prototype/nav";
  import { input } from "#lib/prototype/input.svelte";
  import { view } from "#lib/prototype/view.svelte.js";
  import { motion } from "#lib/prototype/motion/tier.svelte";
  import type { MotionTier } from "#lib/prototype/motion/tier";

  // The hash router keeps the query inside the hash: #/prototype?screen=controls.
  const params = $derived(new URLSearchParams(page.url.hash.split("?")[1] ?? ""));
  const initial = untrack(() => params);

  function href(patch: Record<string, string | null>): string {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    return `#/prototype?${next}`;
  }

  // The 3D backdrop, the low-power switch and a pinned motion tier, from the URL.
  $effect(() => {
    view.scene = params.get("scene") === "sky" ? "sky" : "studio";
    view.lowPower = params.get("lowPower") === "1";
    motion.lowPower = view.lowPower;
    const s3 = params.get("scene3d");
    view.scene3d = s3 === "fail" || s3 === "hold" || s3 === "nogl" ? s3 : "";
    const tier = params.get("tier");
    motion.pinned = tier === "full" || tier === "lite" || tier === "still" ? (tier as MotionTier) : null;
  });
  $effect(() => motion.watch());

  let tod = $state(initial.get("tod") ?? "noon");
  if (typeof document !== "undefined") document.documentElement.dataset.tod = untrack(() => tod);
  $effect(() => {
    document.documentElement.dataset.tod = tod;
  });

  const list = (key: string) => (initial.get(key) ?? "").split(",").filter(Boolean);
  const no = (initial.get("no") ?? "").split(",");
  const streamParam = initial.get("state");
  const sim = new LiveSim({
    status: streamParam === "loading" || streamParam === "stalled" || streamParam === "error" ? (streamParam as StreamStatus) : "live",
    has: { battery: !no.includes("battery"), ev: !no.includes("ev"), scene: !no.includes("scene") },
    strings: Number(initial.get("strings") ?? 3),
    long: initial.get("long") === "1",
    missing: list("missing"),
    stale: list("stale"),
    offline: list("offline") as DeviceId[],
  });
  $effect(() => {
    sim.night = tod === "night";
  });
  $effect(() => sim.start());

  // Dark by default, designed dark-first (ADR 21); a manual override is kept per browser.
  const queryTheme = initial.get("theme");
  let dark = $state(queryTheme ? queryTheme !== "light" : typeof localStorage === "undefined" || localStorage.getItem("proto.theme") !== "light");
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

  // Screens and detail sheets are hash routes, so back closes a sheet and leaves a screen (ADR 21).
  const screen = $derived<Screen>((params.get("screen") ?? "dashboard") in NAV ? ((params.get("screen") ?? "dashboard") as Screen) : "dashboard");
  const detail = $derived(params.get("detail"));
  let pushedDetail = false;
  const clearStats: Record<string, null> = Object.fromEntries(STATS_PARAMS.map((k: string) => [k, null]));
  function navigate(id: Screen): void {
    pushedDetail = false;
    // Leaving a screen drops its own parameters.
    void goto(href({ ...clearStats, screen: id === "dashboard" ? null : id, detail: null, drill: null, p: null }));
  }
  /** "Im Verlauf öffnen": the Statistics screen at the sheet's range and the figure's view. */
  function openHistory(sel: Sel, id: string): void {
    pushedDetail = false;
    const history = buildHistory({ strings: sim.strings.length, battery: sim.has.battery, ev: sim.has.ev, long: sim.long, fresh: statsState === "new" });
    void goto(href({ ...clearStats, ...selParams(history, sel), ...detailView(id), screen: "history", detail: null }));
  }
  /** The Statistics screen's own route changes: a drill pushes, everything else replaces. */
  function statsGo(patch: Record<string, string | null>, push = false): void {
    void goto(href(patch), { replaceState: !push, reset: false });
  }
  const statsParam = initial.get("stats");
  const statsState = statsParam === "loading" || statsParam === "error" || statsParam === "new" ? statsParam : "ok";
  function openDetail(id: string): void {
    // Opening from the dashboard pushes one entry; switching figures inside the sheet replaces it.
    const replace = detail !== null;
    if (!replace) pushedDetail = true;
    void goto(href({ detail: id }), { replaceState: replace });
  }
  function closeDetail(): void {
    if (detail === null) return;
    if (pushedDetail) {
      pushedDetail = false;
      history.back();
    } else void goto(href({ detail: null }), { replaceState: true });
  }

  const drill = initial.get("drill");
  const drillP = initial.get("p");
  const railOpen = initial.get("rail") === "open";
  const writes = initial.get("writes") !== "off";
</script>

<svelte:head><title>SunReye · Prototyp</title></svelte:head>

<!-- Backdrop: only the sun-tinted spotlight under the glass. -->
<div class="pointer-events-none fixed inset-0 -z-10 bg-background" aria-hidden="true">
  <div class="absolute inset-0 bg-spotlight"></div>
</div>

<Shell {screen} onnavigate={navigate} {sim} forceExpanded={railOpen}>
  {#key screen}
    <main class="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-200">
      {#if screen === "dashboard"}
        <Dashboard {sim} {dark} {tod} onopen={openDetail} onnavigate={navigate} />
      {:else if screen === "controls"}
        <Controls initial={drill} initialProgress={drillP ? Number(drillP) : undefined} {writes} />
      {:else if screen === "history"}
        <Statistics {sim} {params} go={statsGo} state={statsState} long={sim.long} />
      {:else}
        <SecondaryScreen {screen} {sim} />
      {/if}
    </main>
  {/key}
</Shell>

<DetailSheet id={detail} {sim} onclose={closeDetail} onopen={openDetail} onhistory={openHistory} />

<Toaster theme={dark ? "dark" : "light"} position={input.shell === "bar" ? "top-center" : "bottom-right"} />

{#if import.meta.env.DEV}
  <DevBar {tod} ontod={(t) => (tod = t)} {dark} ondark={setDark} onscene={(m) => void goto(href({ scene: m }), { replaceState: true })} initialOpen={initial.get("dev") === "open"} />
{/if}

<style>
  /* Touch targets: the registry's small segments and tabs are 28–32 px; a finger gets 40 (WCAG 2.2 AA is 24, platforms ask 44). */
  @media (pointer: coarse) {
    :global([data-slot="toggle-group-item"]),
    :global([data-slot="tabs-trigger"]) {
      min-height: 2.5rem;
      min-width: 2.5rem;
    }
  }
</style>

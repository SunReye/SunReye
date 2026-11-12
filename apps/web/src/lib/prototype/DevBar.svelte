<!-- PROTOTYPE: dev controls only: theme, time of day, scene mode, 3D/2D. Collapsed by default so it never covers the design. -->
<script lang="ts">
  import Sunrise from "@lucide/svelte/icons/sunrise";
  import Sun from "@lucide/svelte/icons/sun";
  import Sunset from "@lucide/svelte/icons/sunset";
  import MoonStar from "@lucide/svelte/icons/moon-star";
  import Moon from "@lucide/svelte/icons/moon";
  import SunMedium from "@lucide/svelte/icons/sun-medium";
  import Wrench from "@lucide/svelte/icons/wrench";
  import { input } from "./input.svelte";
  import { view, setHero } from "./view.svelte";

  let {
    tod,
    ontod,
    dark,
    ondark,
    onscene,
    initialOpen = false,
  }: {
    tod: string;
    ontod: (t: string) => void;
    dark: boolean;
    ondark: (d: boolean) => void;
    onscene: (m: "studio" | "sky") => void;
    initialOpen?: boolean;
  } = $props();

  // svelte-ignore state_referenced_locally
  let open = $state(initialOpen);
  const TODS = [
    { id: "dawn", label: "Morgen", icon: Sunrise },
    { id: "noon", label: "Mittag", icon: Sun },
    { id: "dusk", label: "Abend", icon: Sunset },
    { id: "night", label: "Nacht", icon: MoonStar },
  ];
  const btn = "grid h-7 min-w-7 place-items-center rounded-sm px-1.5 text-white/70 hover:bg-white/10 hover:text-white aria-pressed:bg-white/15 aria-pressed:text-white";
</script>

<div
  class={[
    "fixed right-0.5 z-[45] flex items-center gap-0.5 rounded-md text-xs font-medium text-white",
    open && "bg-zinc-950/90 p-0.5 ring-1 ring-white/15",
    input.shell === "bar" ? "bottom-[calc(84px+env(safe-area-inset-bottom))]" : "bottom-0.5",
  ]}
  role="toolbar"
  aria-label="Prototyp"
>
  {#if open}
    {#each TODS as t (t.id)}
      <button type="button" class={btn} title={t.label} aria-label={t.label} aria-pressed={tod === t.id} onclick={() => ontod(t.id)}><t.icon class="size-3.5" /></button>
    {/each}
    <span class="mx-0.5 h-4 w-px bg-white/20"></span>
    <button type="button" class={btn} title="3D-Hintergrund" onclick={() => onscene(view.scene === "sky" ? "studio" : "sky")}>{view.scene === "sky" ? "Himmel" : "Studio"}</button>
    <button type="button" class={btn} title="Hero-Ansicht" onclick={() => setHero(view.hero === "3d" ? "2d" : "3d")}>{view.hero === "3d" ? "3D" : "2D"}</button>
    <button type="button" class={btn} aria-label={dark ? "Hell" : "Dunkel"} onclick={() => ondark(!dark)}>
      {#if dark}<SunMedium class="size-3.5" />{:else}<Moon class="size-3.5" />{/if}
    </button>
  {/if}
  <button
    type="button"
    class={["grid size-5 place-items-center rounded-sm", open ? "text-white hover:bg-white/10" : "bg-zinc-950/60 text-white/60 hover:text-white"]}
    aria-label="Prototyp-Schalter"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    <Wrench class="size-3" />
  </button>
</div>

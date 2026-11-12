<!-- PROTOTYPE: floating variant switcher + dev controls (time of day, theme). Dev builds only. -->
<script lang="ts">
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Sunrise from "@lucide/svelte/icons/sunrise";
  import Sun from "@lucide/svelte/icons/sun";
  import Sunset from "@lucide/svelte/icons/sunset";
  import MoonStar from "@lucide/svelte/icons/moon-star";
  import Moon from "@lucide/svelte/icons/moon";
  import SunMedium from "@lucide/svelte/icons/sun-medium";
  import { input } from "./input.svelte";
  import { Button } from "#lib/components/ui/button/index.js";

  let {
    keys,
    names,
    current,
    onvariant,
    tod,
    ontod,
    dark,
    ondark,
    scene,
    onscene,
  }: {
    keys: string[];
    names: Record<string, string>;
    current: string;
    onvariant: (k: string) => void;
    tod: string;
    ontod: (t: string) => void;
    dark: boolean;
    ondark: (d: boolean) => void;
    scene: "studio" | "sky";
    onscene: (m: "studio" | "sky") => void;
  } = $props();

  const TODS = [
    { id: "dawn", label: "Morgen", icon: Sunrise },
    { id: "noon", label: "Mittag", icon: Sun },
    { id: "dusk", label: "Abend", icon: Sunset },
    { id: "night", label: "Nacht", icon: MoonStar },
  ];
  const step = (d: number) => keys[(keys.indexOf(current) + d + keys.length) % keys.length]!;

  function key(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t?.closest("input, textarea, [contenteditable], [role=spinbutton], [role=slider]")) return;
    if (e.key === "ArrowLeft") onvariant(step(-1));
    if (e.key === "ArrowRight") onvariant(step(1));
  }
  const todNow = $derived(TODS.find((t) => t.id === tod) ?? TODS[1]!);
</script>

<svelte:window onkeydown={key} />

<div
  class={[
    "fixed left-1/2 z-[45] flex -translate-x-1/2 items-center gap-1 rounded-lg bg-zinc-950/90 p-1 backdrop-blur-md text-xs font-medium text-white shadow-[0_10px_30px_-6px_rgb(0_0_0/0.6)] ring-1 ring-white/15",
    input.shell === "bar" ? "bottom-[calc(96px+env(safe-area-inset-bottom))]" : "bottom-4",
  ]}
  role="toolbar"
  aria-label="Prototyp-Varianten"
>
  <Button variant="ghost" size="icon-sm" class="text-white/70 hover:bg-white/10! hover:text-white aria-pressed:bg-white/15 aria-pressed:text-white" onclick={() => onvariant(step(-1))} aria-label="Vorherige Variante"><ChevronLeft class="size-4" /></Button>
  <span class="min-w-[120px] px-1 text-center whitespace-nowrap"><span class="font-bold text-amber-300">{current}</span> · {names[current]}</span>
  <Button variant="ghost" size="icon-sm" class="text-white/70 hover:bg-white/10! hover:text-white aria-pressed:bg-white/15 aria-pressed:text-white" onclick={() => onvariant(step(1))} aria-label="Nächste Variante"><ChevronRight class="size-4" /></Button>
  <span class="mx-0.5 h-4 w-px bg-white/20"></span>
  {#if input.shell === "bar"}
    <Button variant="ghost" size="icon-sm" class="text-white/70 hover:bg-white/10! hover:text-white aria-pressed:bg-white/15 aria-pressed:text-white" onclick={() => ontod(TODS[(TODS.indexOf(todNow) + 1) % 4]!.id)} aria-label="Tageszeit: {todNow.label}">
      <todNow.icon class="size-3.5" />
    </Button>
  {:else}
    {#each TODS as t (t.id)}
      <Button variant="ghost" size="icon-sm" title={t.label} aria-pressed={tod === t.id} class="text-white/70 hover:bg-white/10! hover:text-white aria-pressed:bg-white/15 aria-pressed:text-white" onclick={() => ontod(t.id)}>
        <t.icon class="size-3.5" />
      </Button>
    {/each}
  {/if}
  <Button variant="ghost" size="sm" class="px-2 text-xs text-white/70 hover:bg-white/10! hover:text-white" onclick={() => onscene(scene === "sky" ? "studio" : "sky")} aria-label="3D-Hintergrund: {scene}" title="3D-Hintergrund">
    {scene === "sky" ? "Himmel" : "Studio"}
  </Button>
  <Button variant="ghost" size="icon-sm" class="text-white/70 hover:bg-white/10! hover:text-white aria-pressed:bg-white/15 aria-pressed:text-white" onclick={() => ondark(!dark)} aria-label={dark ? "Hell" : "Dunkel"}>
    {#if dark}<SunMedium class="size-3.5" />{:else}<Moon class="size-3.5" />{/if}
  </Button>
</div>

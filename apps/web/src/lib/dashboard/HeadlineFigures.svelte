<!-- What the scene's chips do not carry: the house (or battery, while PV is idle) and the grid. -->
<script lang="ts">
  import { Pressable } from "../components/ui/pressable/index.js";
  import PowerNumber from "../components/power-number.svelte";
  import { m } from "../paraglide/messages.js";

  let {
    plant,
    producing,
    onselect,
  }: {
    plant: Readonly<Record<string, number>>;
    producing: boolean;
    onselect: (id: string) => void;
  } = $props();

  const grid = $derived(plant["grid.power"]);
  const battery = $derived(plant["battery.power"]);
  const exporting = $derived(grid !== undefined && grid < 0);

  const figure =
    "rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";
</script>

<span
  class="pointer-events-auto mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted-foreground"
>
  {#if producing}
    <Pressable class={figure} onclick={() => onselect("house")}
      >{m.dash_house()}
      <span class="font-semibold text-foreground"
        ><PowerNumber
          watts={plant["load.power"] ?? null}
          unitClass="font-normal text-muted-foreground"
        /></span
      ></Pressable
    >
  {:else if battery !== undefined}
    <Pressable class={figure} onclick={() => onselect("battery")}
      >{m.dash_battery()}
      <span class="font-semibold text-battery"
        ><PowerNumber watts={Math.abs(battery)} unitClass="font-normal text-muted-foreground" /></span
      ></Pressable
    >
  {/if}
  {#if grid !== undefined}
    <Pressable class={figure} onclick={() => onselect("grid")}>
      {exporting ? m.dash_grid_export() : m.dash_grid_import()}
      <span class={["font-semibold", exporting ? "text-export" : "text-import"]}
        ><PowerNumber watts={Math.abs(grid)} unitClass="font-normal text-muted-foreground" /></span
      >
    </Pressable>
  {/if}
</span>

<!--
  The 2D view's flows until the ported power flow (ADR 21, #718) takes this place: each plant flow
  the `plant` device has, in its energy colour. A flow opens its detail.
-->
<script lang="ts">
  import AnimatedNumber from "../components/animated-number.svelte";
  import { m } from "../paraglide/messages.js";

  let {
    plant,
    top,
    onselect,
  }: {
    plant: Readonly<Record<string, number>> | undefined;
    /** Pixels the headline takes above. */
    top: number;
    onselect: (id: string) => void;
  } = $props();

  const flows = $derived.by(() => {
    if (plant === undefined) return [];

    const grid = plant["grid.power"];

    const all = [
      { id: "pv", label: m.dash_pv(), watts: plant["pv.power"], colour: "var(--e-solar)" },
      {
        id: "battery",
        label: m.dash_battery(),
        watts: plant["battery.power"],
        colour: "var(--e-battery)",
      },
      { id: "house", label: m.dash_house(), watts: plant["load.power"], colour: "var(--e-house)" },
      {
        id: "grid",
        label: grid !== undefined && grid < 0 ? m.dash_grid_export() : m.dash_grid_import(),
        watts: grid,
        colour: grid !== undefined && grid < 0 ? "var(--e-export)" : "var(--e-import)",
      },
      { id: "ev", label: m.dash_ev(), watts: plant["ev.charge.power"], colour: "var(--e-ev)" },
    ];

    // A flow shows only when the plant has its role (ADR 21).
    return all.filter((flow) => flow.watts !== undefined);
  });
</script>

<ul
  class="absolute inset-x-0 bottom-0 grid content-center gap-2 px-4 pb-4 sm:grid-cols-2"
  style:top="{top}px"
>
  {#each flows as flow (flow.id)}
    <li>
      <button
        type="button"
        class="flex w-full items-baseline justify-between gap-3 rounded-sm px-3 py-2 text-left outline-none transition-colors hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring"
        onclick={() => {
          onselect(flow.id);
        }}
      >
        <span class="flex items-center gap-1.5 text-sm font-medium text-muted-foreground"
          ><span class="size-2 rounded-[1px]" style:background={flow.colour}
          ></span>{flow.label}</span
        >
        <span class="text-xl font-semibold tracking-tight whitespace-nowrap"
          ><AnimatedNumber value={Math.abs(flow.watts ?? 0) / 1000} />
          <span class="text-xs font-medium text-muted-foreground">kW</span></span
        >
      </button>
    </li>
  {/each}
</ul>

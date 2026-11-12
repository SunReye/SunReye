<!--
  One 3D label chip (ADR 20): ambient glass, a flow-colour dot, an icon and the gliding value.
  Ported from the prototype's Scene3d chips. Tapping opens the equipment's detail sheet.
-->
<script lang="ts">
  import BatteryCharging from "@lucide/svelte/icons/battery-charging";
  import Car from "@lucide/svelte/icons/car";
  import Cpu from "@lucide/svelte/icons/cpu";
  import House from "@lucide/svelte/icons/house";
  import Sun from "@lucide/svelte/icons/sun";
  import UtilityPole from "@lucide/svelte/icons/utility-pole";
  import AnimatedNumber from "../components/animated-number.svelte";
  import { Button } from "../components/ui/button/index.js";
  import { m } from "../paraglide/messages.js";
  import type { Chip, ChipKind } from "./labels.ts";

  let { chip, onselect }: { chip: Chip; onselect: (id: string) => void } = $props();

  const NAMES: Readonly<Record<Exclude<ChipKind, "string">, () => string>> = {
    inverter: m.detail_inverter,
    battery: m.dash_battery,
    grid: m.detail_grid,
    house: m.dash_house,
    car: m.dash_ev,
  };

  const ICONS = {
    string: Sun,
    inverter: Cpu,
    battery: BatteryCharging,
    grid: UtilityPole,
    house: House,
    car: Car,
  } satisfies Record<ChipKind, typeof Sun>;

  // Whole class names, so Tailwind finds them.
  const DOTS = {
    solar: "bg-solar",
    battery: "bg-battery",
    import: "bg-import",
    export: "bg-export",
    house: "bg-house",
    ev: "bg-ev",
  };

  const TINTS = {
    solar: "text-solar",
    battery: "text-battery",
    import: "text-import",
    export: "text-export",
    house: "text-house",
    ev: "text-ev",
  };

  /** Grid import is the import flow; export, and every other kind, its own colour. */
  const flow = $derived.by((): keyof typeof DOTS => {
    switch (chip.kind) {
      case "grid":
        return (chip.watts ?? 0) > 0 ? "import" : "export";
      case "string":
      case "inverter":
        return "solar";
      case "car":
        return "ev";
      default:
        return chip.kind;
    }
  });

  /** Battery charging and grid export point up (ADR 4 signs), as in the 2D flow. */
  const arrow = $derived.by(() => {
    const watts = chip.watts ?? 0;

    if (watts === 0 || (chip.kind !== "battery" && chip.kind !== "grid")) return "";

    return (chip.kind === "battery") === watts > 0 ? "↑" : "↓";
  });

  const name = $derived(chip.kind === "string" ? (chip.name ?? "") : NAMES[chip.kind]());

  const Icon = $derived(ICONS[chip.kind]);
</script>

<Button
  variant="ghost"
  size="sm"
  onclick={() => {
    onselect(chip.id);
  }}
  class={[
    "glass-ambient h-7 gap-1.5 px-2 text-xs ring-1 ring-border/60 elevation-1",
    chip.stale && "opacity-60",
  ]}
  title={chip.stale ? m.live_stale_short() : undefined}
  aria-label={m.flow_details({ name })}
>
  <span class="size-1.5 rounded-full {DOTS[flow]}"></span>
  <Icon class={["size-3.5", chip.kind === "inverter" ? "text-muted-foreground" : TINTS[flow]]} />
  {#if chip.name !== null}<span class="text-muted-foreground">{chip.name}</span>{/if}
  <span
    >{#if arrow}<span class="me-1">{arrow}</span>{/if}{#if chip.estimated}<span
        class="me-0.5 text-muted-foreground">≈</span
      >{/if}<AnimatedNumber value={chip.watts === null ? null : Math.abs(chip.watts) / 1000} />
    <span class="text-muted-foreground">{chip.kind === "inverter" ? "kW AC" : "kW"}</span></span
  >
  {#if chip.soc !== null}
    <span class="text-muted-foreground"><AnimatedNumber value={chip.soc} digits={0} /> %</span>
  {/if}
</Button>

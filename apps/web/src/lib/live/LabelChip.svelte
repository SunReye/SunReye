<!--
  One 3D label chip (ADR 20): ambient glass, a flow-colour dot, an icon and the gliding value.
  Ported from the prototype's Scene3d chips. Tapping opens the equipment's detail sheet.
-->
<script lang="ts">
  import AnimatedNumber from "../components/animated-number.svelte";
  import PowerNumber from "../components/power-number.svelte";
  import { Button } from "../components/ui/button/index.js";
  import { flowColour, type Flow } from "../energy-colours.ts";
  import { KIND_ICONS, KIND_NAMES } from "../equipment-kinds.ts";
  import { m } from "../paraglide/messages.js";
  import type { Chip } from "./labels.ts";

  let { chip, onselect }: { chip: Chip; onselect: (id: string) => void } = $props();

  /** Grid import is the import flow; export, and every other kind, its own colour. */
  const flow = $derived.by((): Flow => {
    switch (chip.kind) {
      case "grid":
        return (chip.watts ?? 0) > 0 ? "import" : "export";
      case "string":
      case "inverter":
        return "solar";
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

  const name = $derived(chip.name ?? KIND_NAMES[chip.kind]());

  const Icon = $derived(KIND_ICONS[chip.kind]);
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
  <span class="size-1.5 rounded-full" style:background-color={flowColour(flow)}></span>
  <Icon
    class={["size-3.5", chip.kind === "inverter" && "text-muted-foreground"]}
    style={chip.kind === "inverter" ? undefined : `color: ${flowColour(flow)}`}
  />
  {#if chip.name !== null}<span class="text-muted-foreground">{chip.name}</span>{/if}
  <span
    >{#if arrow}<span class="me-1">{arrow}</span>{/if}{#if chip.estimated}<span
        class="me-0.5 text-muted-foreground">≈</span
      >{/if}<PowerNumber
      watts={chip.watts === null ? null : Math.abs(chip.watts)}
      unitClass="text-muted-foreground"
      suffix={chip.kind === "inverter" ? " AC" : ""}
    /></span
  >
  {#if chip.soc !== null}
    <span class="text-muted-foreground"><AnimatedNumber value={chip.soc} digits={0} /> %</span>
  {/if}
</Button>

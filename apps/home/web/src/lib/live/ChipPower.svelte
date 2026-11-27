<!-- A label chip's power: an arrow for the direction (ADR 4 signs), ≈ when estimated. -->
<script lang="ts">
  import PowerNumber from "../components/power-number.svelte";
  import type { Chip } from "./labels.ts";

  let { chip }: { chip: Chip } = $props();

  /** Battery charging and grid export point up, as in the 2D flow. */
  const arrow = $derived.by(() => {
    const watts = chip.watts ?? 0;

    if (watts === 0 || (chip.kind !== "battery" && chip.kind !== "grid")) return "";

    return (chip.kind === "battery") === watts > 0 ? "↑" : "↓";
  });
</script>

<span>
  {#if arrow}<span class="me-1">{arrow}</span>{/if}{#if chip.estimated}<span
      class="me-0.5 text-muted-foreground"
    >
      ≈
    </span>{/if}<PowerNumber
    watts={chip.watts === null ? null : Math.abs(chip.watts)}
    unitClass="text-muted-foreground"
    suffix={chip.kind === "inverter" ? " AC" : ""}
  />
</span>

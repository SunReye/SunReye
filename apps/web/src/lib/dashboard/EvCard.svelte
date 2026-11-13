<!-- One EVCC loadpoint (ADR 10): what it charges, the vehicle's state of charge and its target. -->
<script lang="ts">
  import { Pressable } from "../components/ui/pressable/index.js";
  import Car from "@lucide/svelte/icons/car";
  import * as Card from "#lib/components/ui/card/index.js";
  import { Progress } from "#lib/components/ui/progress/index.js";
  import AnimatedNumber from "../components/animated-number.svelte";
  import PowerNumber from "../components/power-number.svelte";
  import { formatFigure, type FigureId } from "../detail/figures.ts";
  import { tickGlideMs } from "../live/stream.svelte.ts";
  import { m } from "../paraglide/messages.js";

  let {
    device,
    name,
    values,
    onopen,
  }: {
    device: number;
    /** The device's name; unknown to a viewer, who may not list devices (ADR 9). */
    name: string | undefined;
    /** Its live values by series name, its `ev` roles (ADR 4). */
    values: Readonly<Record<string, number>>;
    /** Opens the loadpoint's detail. */
    onopen: (id: FigureId) => void;
  } = $props();

  const power = $derived(values["ev.charge.power"]);
  const soc = $derived(values["ev.vehicle.soc"]);
  const limit = $derived(values["ev.limit.soc"]);

  const state = $derived(
    values["ev.charging"] === 1 || (power ?? 0) > 50
      ? m.evcc_charging()
      : values["ev.connected"] === 1
        ? m.evcc_connected()
        : m.evcc_empty(),
  );
</script>

<Card.Root size="sm" class="glass-ambient shrink-0 gap-0 py-0">
  <Pressable
    class="flex items-center gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-foreground/[0.08]"
    onclick={() => {
      onopen(formatFigure({ kind: "ev", id: device }));
    }}
  >
    <span class="grid size-9 shrink-0 place-items-center rounded-md bg-ev/15 text-ev"
      ><Car class="size-5" /></span
    >
    <span class="flex min-w-0 flex-1 flex-col gap-1.5" style:--glide="{tickGlideMs()}ms">
      <span class="flex items-baseline gap-2">
        <span class="min-w-0 truncate text-sm font-semibold">{name ?? m.evcc_title()}</span>
        <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">{state}</span>
        <span class="text-base font-semibold whitespace-nowrap"
          ><PowerNumber
            watts={power ?? null}
            unitClass="text-xs font-medium text-muted-foreground"
          /></span
        >
      </span>
      <Progress value={soc ?? 0} size="square" class="ev" aria-label={m.dash_ev_soc()} />
      <span class="flex justify-between text-xs text-muted-foreground tabular-nums"
        ><span><AnimatedNumber value={soc ?? null} digits={0} /> %</span><span
          >{limit === undefined ? " " : m.dash_ev_target({ soc: Math.round(limit) })}</span
        ></span
      >
    </span>
  </Pressable>
</Card.Root>

<style>
  :global(.ev > [data-slot="progress-indicator"]) {
    background: var(--e-ev);
    transition-duration: var(--glide);
  }
</style>

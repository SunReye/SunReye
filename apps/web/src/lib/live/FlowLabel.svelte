<script lang="ts">
  import { m } from "../paraglide/messages.js";
  import type { Quantity } from "./labels.ts";

  let {
    quantities,
    at,
    format,
  }: {
    quantities: readonly Quantity[];
    /** Pixels on the canvas. */
    at: readonly [number, number];
    format: Intl.NumberFormat;
  } = $props();

  /** An SI symbol, the same in every locale. */
  const power = (value: number): string => `${format.format(Math.abs(value))} W`;

  const grid = (watts: number): string =>
    watts < 0
      ? m.live_grid_export({ power: power(watts) })
      : m.live_grid_import({ power: power(watts) });

  function battery(watts: number): string {
    if (watts === 0) return m.live_battery_idle();

    return watts > 0
      ? m.live_battery_charge({ power: power(watts) })
      : m.live_battery_discharge({ power: power(watts) });
  }

  const texts = {
    grid,
    house: (watts: number) => m.live_house({ power: power(watts) }),
    inverter: (watts: number) => m.live_inverter({ power: power(watts) }),
    battery,
  } satisfies Record<Exclude<Quantity["kind"], "car">, (watts: number) => string>;

  /** A connected car charges or waits. */
  const car = (watts: number | null): string =>
    watts === null || watts === 0
      ? m.live_car_connected()
      : m.live_car_charging({ power: power(watts) });

  const key = (quantity: Quantity): string | number =>
    quantity.kind === "inverter" || quantity.kind === "car"
      ? `${quantity.kind}${quantity.device}`
      : quantity.kind;
</script>

<output style:left="{at[0]}px" style:top="{at[1]}px">
  {#each quantities as quantity (key(quantity))}
    <span
      >{quantity.kind === "car" ? car(quantity.watts) : texts[quantity.kind](quantity.watts)}</span
    >
    {#if (quantity.kind === "battery" || quantity.kind === "car") && quantity.soc !== null}
      <span>{m.live_soc({ soc: format.format(quantity.soc) })}</span>
    {/if}
  {/each}
</output>

<style>
  output {
    position: absolute;
    display: grid;
    translate: -50% -100%;
    pointer-events: none;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    background: #fffffff0;
    color: #1d232b;
    font-size: 0.875rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
</style>

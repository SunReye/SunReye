<script lang="ts">
  import { m } from "./paraglide/messages.js";
  import { getLocale } from "./paraglide/runtime.js";

  /** One loadpoint's live values by series name, its `ev` roles (ADR 4). */
  let { values }: { values: Readonly<Record<string, number>> } = $props();

  const whole = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 0 });
  const kilowattHours = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 });

  const state = $derived(
    values["ev.charging"] === 1
      ? m.evcc_charging()
      : values["ev.connected"] === 1
        ? m.evcc_connected()
        : m.evcc_empty(),
  );

  const power = $derived(values["ev.charge.power"]);
  const soc = $derived(values["ev.vehicle.soc"]);
  const session = $derived(values["ev.session.energy"]);
</script>

<!-- Units are SI symbols, the same in every locale. -->
<article>
  <h2>{m.evcc_title()}</h2>
  <p>{state}</p>
  <dl>
    {#if power !== undefined}
      <div>
        <dt>{m.evcc_power()}</dt>
        <dd>{whole.format(power)} W</dd>
      </div>
    {/if}
    {#if soc !== undefined}
      <div>
        <dt>{m.evcc_soc()}</dt>
        <dd>{whole.format(soc)} %</dd>
      </div>
    {/if}
    {#if session !== undefined}
      <div>
        <dt>{m.evcc_session()}</dt>
        <dd>{kilowattHours.format(session)} kWh</dd>
      </div>
    {/if}
  </dl>
</article>

<style>
  dl {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
  }

  dd {
    margin: 0;
    font-size: 1.5rem;
    font-variant-numeric: tabular-nums;
  }
</style>

<script lang="ts">
  import type { Core, Values } from "../api/core";
  import { problemText } from "../i18n/problems";
  import { m } from "../paraglide/messages.js";
  import SpotPriceCard from "../SpotPriceCard.svelte";
  import { ctPerKwh } from "./format";

  let { core }: { core: Core } = $props();

  let devices = $state.raw<Values["devices"]>({});
  let refused = $state.raw<string>();

  $effect(() =>
    core.live((next) => {
      refused = "problem" in next ? next.problem : undefined;
      devices = "devices" in next ? next.devices : {};
    }),
  );

  // The tariff device is told by its `price.import`, the spot-price device by its `price.spot`.
  const tariff = $derived(Object.values(devices).find((values) => "price.import" in values));

  const spot = $derived(Object.values(devices).find((values) => "price.spot" in values));
</script>

<section>
  <h2>{m.tariff_prices_now()}</h2>
  {#if refused !== undefined}
    <p role="alert">{problemText(refused)}</p>
  {/if}
  {#if tariff !== undefined}
    <dl>
      <div>
        <dt>{m.tariff_import()}</dt>
        <dd>{ctPerKwh(tariff["price.import"])}</dd>
      </div>
      <div>
        <dt>{m.tariff_export()}</dt>
        <dd>{ctPerKwh(tariff["price.export"])}</dd>
      </div>
    </dl>
  {/if}
  {#if spot !== undefined}
    <SpotPriceCard values={spot} />
  {/if}
</section>

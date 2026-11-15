<script lang="ts">
  import StatStrip from "../components/stat-strip.svelte";
  import Section from "../components/section.svelte";
  import ProblemAlert from "../components/problem-alert.svelte";
  import type { Core, Values } from "../api/core";
  import LoadingRows from "../components/loading-rows.svelte";
  import { m } from "../paraglide/messages.js";
  import SpotPriceCard from "../SpotPriceCard.svelte";
  import { ctPerKwh } from "./format";

  let { core }: { core: Core } = $props();

  let devices = $state.raw<Values["devices"]>({});
  let refused = $state.raw<string>();

  /** No live frame yet: the prices stand in skeleton rows. */
  let waiting = $state(true);

  $effect(() =>
    core.live((next) => {
      waiting = false;
      refused = "problem" in next ? next.problem : undefined;
      devices = "devices" in next ? next.devices : {};
    }),
  );

  // The tariff device is told by its `price.import`, the spot-price device by its `price.spot`.
  const tariff = $derived(Object.values(devices).find((values) => "price.import" in values));

  const spot = $derived(Object.values(devices).find((values) => "price.spot" in values));
</script>

<Section title={m.tariff_prices_now()}>
  {#if waiting}
    <LoadingRows />
  {/if}
  {#if refused !== undefined}
    <ProblemAlert problem={refused} />
  {/if}
  {#if tariff !== undefined}
    <StatStrip
      stats={[
        { label: m.tariff_import(), value: ctPerKwh(tariff["price.import"]) },
        { label: m.tariff_export(), value: ctPerKwh(tariff["price.export"]) },
      ]}
    />
  {/if}
  {#if spot !== undefined}
    <SpotPriceCard values={spot} />
  {/if}
</Section>

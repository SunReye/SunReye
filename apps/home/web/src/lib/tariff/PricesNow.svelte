<script lang="ts">
  import StatStrip from "../components/stat-strip.svelte";
  import Section from "../components/section.svelte";
  import ProblemAlert from "../components/problem-alert.svelte";
  import LoadingRows from "../components/loading-rows.svelte";
  import { m } from "../paraglide/messages.js";
  import SpotPriceCard from "../SpotPriceCard.svelte";
  import { stream } from "../live/stream.svelte.ts";
  import { ctPerKwh } from "./format";

  const live = $derived(stream.live);

  /** No live frame yet: the prices stand in skeleton rows. */
  const waiting = $derived(live === undefined);

  const refused = $derived(live !== undefined && "problem" in live ? live.problem : undefined);

  const devices = $derived(live !== undefined && "devices" in live ? live.devices : {});

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
        { label: m.tariff_import(), text: ctPerKwh(tariff["price.import"]) },
        { label: m.tariff_export(), text: ctPerKwh(tariff["price.export"]) },
      ]}
    />
  {/if}
  {#if spot !== undefined}
    <SpotPriceCard values={spot} />
  {/if}
</Section>

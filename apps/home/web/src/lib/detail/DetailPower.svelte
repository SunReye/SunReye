<!--
  A node's live power in the sheet's header: the lead figure, or second to the range's figure. Its
  label says the direction in words; the sign itself never reaches the reader.
-->
<script lang="ts">
  import { m } from "../paraglide/messages.js";
  import type { Figure } from "./figures.ts";
  import Quantity from "./Quantity.svelte";
  import { ago, type NodeReadings } from "./readings.ts";

  let {
    spec,
    node,
    loading,
    second,
  }: {
    spec: Figure;
    node: NodeReadings | null;
    loading: boolean;
    /** It stands beside the range's figure, smaller. */
    second: boolean;
  } = $props();

  const watts = $derived(node?.lead ?? null);
  const silent = $derived(node?.silent ?? null);

  const direction = $derived.by(() => {
    if (spec.direction === undefined || watts === null || Math.abs(watts) < 50) return "";

    if (spec.direction === "battery")
      return watts > 0 ? m.detail_charging() : m.detail_discharging();

    return watts > 0 ? m.detail_importing() : m.detail_exporting();
  });

  const nowLine = $derived(
    [m.detail_now(), direction, node?.leadEstimated ? m.detail_estimated() : ""]
      .filter(Boolean)
      .join(" · "),
  );
</script>

<p class={["flex flex-col", second && "items-end text-right"]}>
  <span
    class={[
      second ? "text-xl" : "text-4xl",
      "leading-none font-semibold tracking-tight",
      silent !== null && "opacity-60",
    ]}
  >
    {#if node?.leadEstimated}<span
        class="me-1 font-normal text-muted-foreground"
        title={m.detail_estimated()}
        aria-label={m.detail_estimated()}
      >
        ≈
      </span>{/if}<Quantity
      value={loading || watts === null ? null : Math.abs(watts)}
      unit="W"
      unitClass={[second ? "text-sm" : "text-lg", "font-medium text-muted-foreground"]}
    />
  </span>
  <!-- The label stops claiming "now" the moment the readings do. -->
  {#if silent !== null}
    <span class="mt-1 text-xs text-warning">{m.detail_last({ age: ago(silent) })}</span>
  {:else}
    <span class="mt-1 text-xs text-muted-foreground">{nowLine}</span>
  {/if}
</p>

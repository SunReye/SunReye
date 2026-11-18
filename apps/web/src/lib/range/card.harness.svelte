<!-- Test harness: a full screen's range card, its chart of two bands under a heading. -->
<script lang="ts">
  import "../../app.css";
  import type { Band } from "./bands.ts";
  import BandChart from "./BandChart.svelte";
  import RangeCard from "./RangeCard.svelte";

  let { steps }: { steps: (-1 | 1)[] } = $props();

  const band = (key: string, up: number): Band => ({
    key,
    label: key,
    tick: true,
    title: `Band ${key}`,
    state: "data",
    partial: false,
    up: [up],
    down: [],
    drillable: true,
  });

  const model = {
    step: (dir: -1 | 1) => {
      steps.push(dir);
    },
  };
</script>

<div style="width: 400px">
  <RangeCard {model}>
    <h2 style="height: 80px">Heute</h2>
    <BandChart
      bands={[band("b0", 2), band("b1", 4)]}
      up={[{ label: "PV", colour: "var(--e-solar)" }]}
      summary={{ title: "Summe", up: [6], down: [] }}
      fmt={(v) => `${v.toFixed(1)} kWh`}
      unit="kWh"
      label="Produktion"
    />
  </RangeCard>
</div>

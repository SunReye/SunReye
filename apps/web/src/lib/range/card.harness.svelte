<!-- Test harness: a range card over days, its stepper and title standing, its day's chart travelling. -->
<script lang="ts">
  import "../../app.css";
  import type { Band } from "./bands.ts";
  import BandChart from "./BandChart.svelte";
  import { rangeFor, step, type Range, type Via } from "./range.ts";
  import RangeCard from "./RangeCard.svelte";
  import RangePane from "./RangePane.svelte";
  import Stepper from "./Stepper.svelte";
  import { RangeTravel } from "./travel.svelte.ts";

  let { steps }: { steps: (-1 | 1)[] } = $props();

  const TODAY = 20_770;
  const cal = { today: TODAY, hour: 12, last: TODAY };

  let range = $state.raw<Range>(rangeFor("day", TODAY - 2));
  let via = $state.raw<Via>({ id: 0, kind: "none", a: 0, b: 1, inward: true, dir: 0 });

  const route = {
    get range() {
      return range;
    },
    get via() {
      return via;
    },
    place: { cal },
    step: (dir: -1 | 1) => {
      steps.push(dir);
      range = step(cal, range, dir);
      via = { id: via.id + 1, kind: "morph", a: 0, b: 1, inward: true, dir };
    },
  };

  // The figures come at once: the range shown is the range read.
  const travel = new RangeTravel(() => ({
    route,
    got: { range, label: `Tag ${range.from - TODAY}` },
    loading: false,
    pending: (_: Readonly<{ range: Range }>, next: Range) => ({
      range: next,
      label: `Nachbar ${next.from - TODAY}`,
    }),
  }));

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
</script>

<div style="width: 400px">
  <RangeCard>
    <h2 style="height: 40px">Heute</h2>
    <Stepper
      label={`Zeitraum ${range.from - TODAY}`}
      dir={via.dir}
      canPrev
      canNext={range.to <= cal.last}
      onstep={route.step}
    />
    <RangePane model={travel}>
      {#snippet children(p)}
        <p style="height: 40px">{p.got.label}</p>
        <BandChart
          bands={[band("b0", 2), band("b1", 4)]}
          up={[{ label: "PV", colour: "var(--e-solar)" }]}
          summary={{ title: "Summe", up: [6], down: [] }}
          fmt={(v) => `${v.toFixed(1)} kWh`}
          unit="kWh"
          loading={p.loading}
          label="Produktion"
        />
      {/snippet}
    </RangePane>
  </RangeCard>
</div>

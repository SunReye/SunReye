<!-- PROTOTYPE: the range over time, for the chosen question: energy flows, money, or where the house load came from. -->
<script lang="ts">
  import BandChart, { type Band, type SeriesMeta } from "./BandChart.svelte";
  import { customSel, grainOf, spanSel, selLabel, type Bucket, type Sum } from "./query";
  import { energy, money, num } from "./format";
  import type { Q } from "./route";

  let { q, height = 240 }: { q: Q; height?: number } = $props();

  interface Spec {
    up: SeriesMeta[];
    down: SeriesMeta[];
    groups: [string, string];
    upOf: (s: Sum) => number[];
    downOf: (s: Sum) => number[];
    fmt: (v: number) => string;
    unit: string;
    max?: number | undefined;
    label: string;
  }
  const share = (v: number, s: Sum) => (s.load! > 0 ? (Math.max(0, v) / s.load!) * 100 : 0);
  // A battery series only where the range moved energy through one.
  const battery = $derived(q.tot.discharge! > 0.05);
  const spec = $derived.by<Spec>(() => {
    if (q.metric === "money")
      return {
        up: [{ label: "vermiedener Bezug", colour: "var(--e-solar)" }, { label: "Einspeisevergütung", colour: "var(--e-export)" }],
        down: [{ label: "Bezugskosten", colour: "var(--e-import)" }],
        groups: ["Ersparnis", "Kosten"],
        upOf: (s) => [s.saved! - s.revenue!, s.revenue!],
        downOf: (s) => [s.cost!],
        fmt: money,
        unit: "€",
        label: "Ersparnis und Kosten über die Zeit",
      };
    if (q.metric === "autarky")
      return {
        up: [{ label: "direkt aus PV", colour: "var(--e-solar)" }, ...(battery ? [{ label: "aus Batterie", colour: "var(--e-battery)" }] : []), { label: "aus dem Netz", colour: "var(--e-import)" }],
        down: [],
        groups: ["", ""],
        upOf: (s) => (battery ? [share(s.load! - s.imp! - s.discharge!, s), share(Math.min(s.discharge!, s.load! - s.imp!), s), share(s.imp!, s)] : [share(s.load! - s.imp!, s), share(s.imp!, s)]),
        downOf: () => [],
        fmt: (v) => `${num(v)} %`,
        unit: "%",
        max: 100,
        label: "Woher der Hausverbrauch kam, über die Zeit",
      };
    return {
      up: [{ label: "selbst genutzt", colour: "var(--e-solar)" }, { label: "eingespeist", colour: "var(--e-export)" }],
      down: [{ label: "selbst gedeckt", colour: "var(--e-house)" }, { label: "Netzbezug", colour: "var(--e-import)" }],
      groups: ["Produktion", "Verbrauch"],
      upOf: (s) => [s.pv! - s.feedIn!, s.feedIn!],
      downOf: (s) => [s.load! - s.imp!, s.imp!],
      fmt: energy,
      unit: "kWh",
      label: "Produktion und Hausverbrauch über die Zeit",
    };
  });

  // The compared span as a mark on each bar's upper side; a share of 100 % has no such mark.
  const versus = $derived(q.cmp && q.metric !== "autarky" ? q.cmp : null);
  const top = (s: Sum) => spec.upOf(s).reduce((a, v) => a + v, 0);
  const bands = $derived(
    q.bs.map((b: Bucket, i): Band => ({
      key: b.key,
      label: b.label,
      tick: b.tick,
      title: b.title,
      state: b.state,
      partial: b.partial,
      up: spec.upOf(b.sum),
      down: spec.downOf(b.sum),
      mark: versus?.bands[i] ? top(versus.bands[i]!) : null,
      // What the forecast still expects, where the weather reaches (ADR 17).
      ghost: q.metric === "energy" && (b.state === "future" || b.state === "live") && b.sum.fc! > 0 ? b.sum.fc! : null,
      drillable: b.drill !== null && b.state !== "future" && b.state !== "before",
    })),
  );
  const drillLabel = $derived({ hour: "Öffnen", day: "Tag öffnen", week: "Woche öffnen", month: "Monat öffnen", year: "Jahr öffnen" }[grainOf(q.sel)]);
</script>

<BandChart
  {bands}
  up={spec.up}
  down={spec.down}
  groups={spec.groups}
  markLabel={versus && bands.some((b) => b.mark != null) ? versus.label : ""}
  ghostLabel={q.metric === "energy" ? "Prognose" : ""}
  via={q.via}
  summary={{ title: `Summe · ${selLabel(q.h, q.sel)}`, up: spec.upOf(q.tot), down: spec.downOf(q.tot), mark: versus ? top(versus.sum) : null }}
  fmt={spec.fmt}
  unit={spec.unit}
  max={spec.max}
  {height}
  loading={q.loading}
  {drillLabel}
  label={spec.label}
  ondrill={(i) => q.bs[i]!.drill && q.open(q.bs[i]!.drill!)}
  onbrush={(a, b) => q.open(grainOf(q.sel) === "hour" ? spanSel(q.h, q.bs[a]!.t0, q.bs[b]!.t1) : customSel(q.h, Math.floor(q.bs[a]!.t0 / 24), Math.ceil(q.bs[b]!.t1 / 24)))}
/>

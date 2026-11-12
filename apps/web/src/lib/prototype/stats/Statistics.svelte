<!--
  PROTOTYPE: the Statistics screen behind "Verlauf" (ADR 11, ADR 21). One question at a time:
  the range's answer up front (production, savings, autarky, the plant's state, each against a
  baseline), the chosen one over time below it, and the deeper analyses one tab away. Range, question
  and tab live in the hash route. Wide screens add the breakdown and the notes beside the chart.
  URL: stats=loading|error|new, long=1 (ten years), strings=1..6, no=battery,ev.
-->
<script lang="ts">
  import { untrack } from "svelte";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import Info from "@lucide/svelte/icons/info";
  import Check from "@lucide/svelte/icons/check";
  import Circle from "@lucide/svelte/icons/circle";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import * as Card from "#lib/components/ui/card/index.js";
  import * as Tabs from "#lib/components/ui/tabs/index.js";
  import * as ToggleGroup from "#lib/components/ui/toggle-group/index.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Progress } from "#lib/components/ui/progress/index.js";
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";
  import AnimatedNumber from "../AnimatedNumber.svelte";
  import RangeControl from "../RangeControl.svelte";
  import { haptics } from "../haptics";
  import { input } from "../input.svelte";
  import type { LiveSim } from "../sim.svelte";
  import { buildHistory, dateOf, dayIndex, TODAY_BASE } from "./history";
  import { motion } from "../motion/tier.svelte";
  import { autarky, baseline, baselineBands, buckets, canStep, change, customSel, fmtDay, spanSel, liveSum, notes, payback, selFor, selfUse, selKey, selLabel, selPhrase, step, stringRows, t0Of, t1Of, total, type Compare, type Kind, type Sel, type StringRow } from "./query";
  import { iso, parseRoute, selParams, STATS_PARAMS, TABS, type Metric, type Q, type Tab } from "./route";
  import { delta, deltaWords, energy, energyRoll, energyTo, money, moneyRoll, moneyTo, num, percent, percentTo } from "./format";
  import type { Via } from "./BandChart.svelte";
  import { edge, Flip } from "./flow";
  import { indicator } from "./indicator";
  import Pager, { type Travel } from "./Pager.svelte";
  import TimePanel from "./TimePanel.svelte";
  import YearsPanel from "./YearsPanel.svelte";
  import PatternPanel from "./PatternPanel.svelte";
  import ForecastPanel from "./ForecastPanel.svelte";
  import TariffPanel from "./TariffPanel.svelte";
  import PaybackPanel from "./PaybackPanel.svelte";
  import StringsPanel from "./StringsPanel.svelte";
  import BatteryPanel from "./BatteryPanel.svelte";
  import DataPanel from "./DataPanel.svelte";

  let {
    sim,
    params,
    go,
    state: given = "ok",
    long = false,
  }: {
    sim: LiveSim;
    params: URLSearchParams;
    /** Patches the hash route; `push` adds a history entry, so back returns from a drill. */
    go: (patch: Record<string, string | null>, push?: boolean) => void;
    state?: "ok" | "loading" | "error" | "new";
    long?: boolean;
  } = $props();

  let retried = $state(false);
  const status = $derived(retried && given === "error" ? "ok" : given);
  const loading = $derived(status === "loading");
  const fresh = $derived(given === "new");

  const h = $derived(buildHistory({ strings: sim.strings.length, battery: sim.has.battery, ev: sim.has.ev, long, fresh }));

  // The route answers after the router has run; the screen moves at once. A change is held here
  // until the route it was made on moves on, so a switch starts in the frame of the tap.
  let ahead = $state.raw<{ on: URLSearchParams; to: URLSearchParams } | null>(null);
  const now = $derived(ahead && ahead.on === params ? ahead.to : params);
  const flow = new Flip();
  function nav(patch: Record<string, string | null>, push = false): void {
    const to = new URLSearchParams(now);
    for (const [k, v] of Object.entries(patch)) (v === null ? to.delete(k) : to.set(k, v));
    flow.arm();
    ahead = { on: params, to };
    // The address follows once the movement is over: the router's own work stays out of its frames.
    // It carries the whole of the screen's route, so quick changes cannot lose each other.
    pushes ||= push;
    clearTimeout(later);
    later = setTimeout(sync, 380);
  }
  let later: ReturnType<typeof setTimeout> | undefined;
  let pushes = false;
  function sync(): void {
    clearTimeout(later);
    later = undefined;
    const to = untrack(() => now);
    go(Object.fromEntries(STATS_PARAMS.map((k: string) => [k, to.get(k)])), pushes);
    pushes = false;
  }
  $effect(() => () => {
    if (later) sync();
  });

  // Parsed only when the screen's own part of the route changes, and the range keeps its identity
  // while it is the same range: a new tab must not recompute the range.
  const routeKey = $derived(STATS_PARAMS.map((k: string) => now.get(k) ?? "").join("&"));
  const route = $derived.by(() => {
    void routeKey;
    return parseRoute(h, untrack(() => now), h.batteryFrom !== null);
  });
  let held: { h: unknown; key: string; sel: Sel } | null = null;
  const sel = $derived.by(() => {
    const next = route.sel;
    const key = selKey(next);
    if (held?.h !== h || held.key !== key) held = { h, key, sel: next };
    return held.sel;
  });
  const cmp = $derived(route.cmp);

  // Today grows with the live stream: what the sim added since the history was read.
  const live = $derived(
    liveSum(h, {
      production: Math.max(0, sim.today.production - TODAY_BASE.production),
      consumption: Math.max(0, sim.today.consumption - TODAY_BASE.consumption),
      feedIn: Math.max(0, sim.today.feedIn - TODAY_BASE.feedIn),
      purchase: Math.max(0, sim.today.purchase - TODAY_BASE.purchase),
    }),
  );

  /** Everything one range shows: the current one, and a neighbour a swipe uncovers. */
  function build(of: Sel, mode: Compare) {
    const bs = buckets(h, of, live);
    const base = baseline(h, of, mode);
    return { sel: of, bs, tot: total(h, of, live), base, rows: stringRows(h, of, live), versus: base ? { label: base.label, bands: baselineBands(h, of, bs, mode), sum: base.sum } : null };
  }
  const cur = $derived(build(sel, cmp));
  const bs = $derived(cur.bs);
  const tot = $derived(cur.tot);
  const base = $derived(cur.base);
  const rows = $derived(cur.rows);
  const hints = $derived(notes(h, sel, bs, rows));
  const warnings = $derived(rows.filter((r) => r.flag === "weak").length);
  const pay = $derived(payback(h, live));
  // Too few days for the model to judge a string.
  const learning = $derived(h.today < 30);

  // ── How a change of range travels (ADR 21) ──
  // A dragged step slides with the finger; an arrow step or a change of granularity morphs the chart
  // in place; a drill or a brush zooms. The controls say which they are; a change that comes from the
  // route alone (back, a link) is read off the two ranges: one inside the other zooms, the rest morph.
  type Trip = Via & { dir: -1 | 0 | 1; slide: boolean; key: string; sel: Sel };
  let said: "kind" | "step" | "swipe" | null = null;
  let saidAt = 0;
  function say(what: "kind" | "step" | "swipe"): void {
    [said, saidAt] = [what, performance.now()];
  }
  let last: Trip | null = null;
  const trip = $derived.by((): Trip => {
    const next = sel;
    const key = selKey(next);
    if (last?.key === key) return last;
    const was = last;
    const hint = said && performance.now() - saidAt < 1500 ? said : null;
    said = null;
    const out: Trip = { id: (was?.id ?? 0) + 1, kind: "none", a: 0, b: 1, inward: true, dir: 0, slide: false, key, sel: next };
    if (was) {
      const [p0, p1, n0, n1] = [t0Of(was.sel), t1Of(was.sel), t0Of(next), t1Of(next)];
      const stepped = hint === "step" || hint === "swipe" || (was.sel.kind === next.kind && next.kind !== "custom");
      if (stepped) out.dir = n0 >= p0 ? 1 : -1;
      if (hint === "kind" || stepped) {
        out.kind = "morph";
        out.slide = hint === "swipe";
      } else if (n0 >= p0 && n1 <= p1) Object.assign(out, { kind: "zoom", inward: true, a: (n0 - p0) / (p1 - p0), b: (n1 - p0) / (p1 - p0) });
      else if (p0 >= n0 && p1 <= n1) Object.assign(out, { kind: "zoom", inward: false, a: (p0 - n0) / (n1 - n0), b: (p1 - n0) / (n1 - n0) });
      else out.kind = "morph";
    }
    last = out;
    return out;
  });
  const STAY: Via = { id: 0, kind: "none", a: 0, b: 1, inward: true };

  function open(next: Sel): void {
    haptics.soft();
    nav(selParams(h, next), true);
  }
  function view(metric: Metric, tab: Tab): void {
    nav({ metric: metric === "energy" ? null : metric, tab: tab === TABS[metric][0]!.id ? null : tab }, true);
  }
  function setKind(kind: Kind): void {
    const anchor = Math.min(h.today, sel.to - 1);
    say("kind");
    nav(selParams(h, kind === "custom" ? customSel(h, anchor - 29, anchor + 1) : selFor(h, kind, anchor)));
  }
  function stepBy(dir: -1 | 1, dragged = false): void {
    if (!canStep(h, sel, dir)) return;
    say(dragged ? "swipe" : "step");
    nav(selParams(h, step(h, sel, dir)));
  }
  const toDay = (s: string) => dayIndex(h.start, new Date(`${s}T00:00`));

  // ── The panel's pane: what it shows, and what makes it a different pane ──
  interface PaneData {
    q: Q;
    rows: StringRow[];
    tab: Tab;
  }
  const qOf = (v: ReturnType<typeof build>, via: Via): Q => ({ h, sel: v.sel, bs: v.bs, tot: v.tot, live, cmp: v.versus, via, metric: route.metric, loading, fresh, open, view });
  const q = $derived(qOf(cur, trip));
  const pane = $derived<PaneData>({ q, rows, tab: route.tab });
  /** Tabs that do not follow the range keep their pane when it steps. */
  function paneId(of: Sel): string {
    const t = route.tab;
    const part = t === "payback" || t === "battery" ? "" : t === "years" ? String(dateOf(h.start, Math.min(h.today, Math.max(0, of.to - 1))).getFullYear()) : selKey(of);
    return `${route.metric}/${t}/${part}`;
  }
  const METRICS: Metric[] = ["energy", "money", "autarky", "plant"];
  const side = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);
  // Which way a new question or a new tab lies, read once per change.
  let metricWas: Metric | null = null;
  const metricSide = $derived.by(() => {
    const m = route.metric;
    const d = metricWas === null ? 0 : side(METRICS.indexOf(m) - METRICS.indexOf(metricWas));
    metricWas = m;
    return d;
  });
  let shown = { metric: untrack(() => route.metric), tab: untrack(() => route.tab) };
  function travel(): Travel {
    const [m, t] = [route.metric, route.tab];
    const morphs = t === "time" || t === "forecast";
    const out: Travel =
      m !== shown.metric
        ? { kind: "shift", dir: side(METRICS.indexOf(m) - METRICS.indexOf(shown.metric)) }
        : t !== shown.tab
          ? { kind: "shift", dir: side(TABS[m].findIndex((x) => x.id === t) - TABS[m].findIndex((x) => x.id === shown.tab)) }
          : trip.slide
            ? { kind: "slide", dir: trip.dir }
            : { kind: morphs ? "keep" : "shift", dir: trip.dir };
    shown = { metric: m, tab: t };
    return out;
  }
  function peek(dir: -1 | 1): { id: string; data: PaneData } | null {
    if (!canStep(h, sel, dir)) return null;
    const next = step(h, sel, dir);
    const id = paneId(next);
    if (id === paneId(sel)) return null;
    const v = build(next, cmp);
    return { id, data: { q: qOf(v, STAY), rows: v.rows, tab: route.tab } };
  }
  let pager = $state<{ swipe: (node: HTMLElement) => () => void }>();

  const aut = $derived(autarky(tot));
  const baseAut = $derived(base ? autarky(base.sum) : null);
  const figures = $derived([
    { id: "energy" as Metric, label: "Produktion", value: tot.pv!, ...energyRoll(tot.pv!), change: change(tot.pv!, base?.sum.pv), points: false },
    { id: "money" as Metric, label: "Ersparnis", value: tot.saved!, ...moneyRoll(tot.saved!), change: change(tot.saved!, base?.sum.saved), points: false },
    { id: "autarky" as Metric, label: "Autarkie", value: aut === null ? null : aut * 100, fmt: (v: number) => num(v), unit: "%", change: aut !== null && baseAut !== null ? aut - baseAut : null, points: true },
  ]);

  const gapHours = $derived(tot.gap!);
  const verdict = $derived.by(() => {
    const when = selPhrase(h, sel);
    const cap = when[0]!.toUpperCase() + when.slice(1);
    if (tot.hours === 0) return sel.to <= 0 || sel.from > h.today ? "Für diesen Zeitraum gibt es keine Aufzeichnung." : "In diesem Zeitraum kamen keine Daten an.";
    const versus = (now: number, was: number | undefined, more?: string, less?: string) => {
      const c = change(now, was);
      return c === null || !base ? "" : `, ${deltaWords(c, more, less)} ${base.within}`;
    };
    if (route.metric === "money") return `${cap} hat die Anlage ${money(tot.saved!)} gespart${versus(tot.saved!, base?.sum.saved)}.`;
    if (route.metric === "autarky") return `${cap} kamen ${percent(aut)} des Hausverbrauchs aus eigener Erzeugung, ${energy(tot.imp!)} aus dem Netz.`;
    if (route.metric === "plant" && learning) return `Für ein Urteil über die Strings fehlen noch Tage: die Korrektur lernt seit ${fmtDay(h, 0)}.`;
    if (route.metric === "plant") return warnings ? `${warnings === 1 ? "Ein MPPT-Eingang liefert" : `${warnings} MPPT-Eingänge liefern`} deutlich weniger, als das Modell erwartet.` : "Keine Auffälligkeiten: alle MPPT-Eingänge liegen am Modell.";
    return `${cap} hat die Anlage ${energy(tot.pv!)} erzeugt${versus(tot.pv!, base?.sum.pv)}.`;
  });

  const tabs = $derived(TABS[route.metric].filter((t) => t.id !== "battery" || h.batteryFrom !== null));
  const prevLabel = $derived({ day: "Vortag", week: "Vorwoche", month: "Vormonat", year: "Vorjahr", custom: "Davor" }[sel.kind]);

  // What the range's flows were worth, beside the chart.
  const p = $derived(h.tariff.findLast((v) => v.from <= Math.min(h.today, sel.to - 1))!);
  interface Row {
    label: string;
    value: number | null;
    fmt: (v: number) => string;
    sub: string | { value: number; fmt: (v: number) => string };
    colour: string;
    indent: boolean;
  }
  const breakdown = $derived.by((): Row[] => {
    const t = tot;
    const row = (label: string, value: number | null, fmt: (v: number) => string, sub: Row["sub"] = "", colour = "", indent = false): Row => ({ label, value, fmt, sub, colour, indent });
    const kwh = (v: number, lead = "") => ({ value: v, fmt: (x: number) => lead + energyTo(v)(x) });
    const eur = (v: number, sign: string) => ({ value: v, fmt: moneyTo(v, sign) });
    const pct = (v: number | null) => (v === null ? "–" : { value: v, fmt: percentTo });
    if (route.metric === "money")
      return [
        row("Rechnung ohne Anlage", t.saved! + t.cost! - t.revenue!, moneyTo(t.saved! + t.cost! - t.revenue!), { value: t.load!, fmt: (x) => `${energyTo(t.load!)(x)} Hausverbrauch` }),
        row("Bezugskosten", t.cost!, moneyTo(t.cost!, "− "), kwh(t.imp!), "var(--e-import)"),
        row("Einspeisevergütung", t.revenue!, moneyTo(t.revenue!, "+ "), kwh(t.feedIn!), "var(--e-export)"),
        row("Ersparnis", t.saved!, moneyTo(t.saved!), "ohne Anlage minus mit Anlage"),
      ];
    if (route.metric === "autarky")
      return [
        row("Autarkie", aut, percentTo, "Anteil des Hausverbrauchs aus eigener Erzeugung", "var(--e-battery)"),
        row("Eigenverbrauch", selfUse(t), percentTo, "Anteil der Produktion, der im Haus blieb", "var(--e-solar)"),
        ...(t.discharge! > 0.05 ? [row("Batterie geladen", t.charge!, energyTo(t.charge!), kwh(t.discharge!, "entladen "), "var(--e-battery)")] : []),
        row("Netzbezug", t.imp!, energyTo(t.imp!), eur(t.cost!, "− "), "var(--e-import)"),
      ];
    if (route.metric === "plant") {
      const kwp = h.strings.reduce((a, s) => a + s.kwp, 0);
      const hours = t.hours! + t.gap!;
      return [
        row("Installierte Leistung", kwp, (v) => `${num(v, 1)} kWp`, `${h.strings.length} ${h.strings.length === 1 ? "String" : "Strings"}`, "var(--e-solar)"),
        row("Spezifischer Ertrag", kwp > 0 ? t.pv! / kwp : null, (v) => `${num(v, v < 100 ? 1 : 0)} kWh/kWp`, "Produktion je installiertem kWp"),
        row("Erfasst", hours > 0 ? t.hours! / hours : null, percentTo, { value: t.gap!, fmt: (v) => `${num(v)} h ohne Daten` }),
      ];
    }
    return [
      row("Produktion", t.pv!, energyTo(t.pv!), "", "var(--e-solar)"),
      row("selbst genutzt", t.pv! - t.feedIn!, energyTo(t.pv! - t.feedIn!), pct(selfUse(t)), "", true),
      row("Einspeisung", t.feedIn!, energyTo(t.feedIn!), eur(t.revenue!, "+ "), "var(--e-export)", true),
      row("Hausverbrauch", t.load!, energyTo(t.load!), "", "var(--e-house)"),
      ...(t.ev! > 0.05 ? [row("davon Auto", t.ev!, energyTo(t.ev!), pct(t.ev! / t.load!), "var(--e-ev)", true)] : []),
      row("Netzbezug", t.imp!, energyTo(t.imp!), eur(t.cost!, "− "), "var(--e-import)", true),
      ...(t.discharge! > 0.05 ? [row("Batterie geladen", t.charge!, energyTo(t.charge!), kwh(t.discharge!, "entladen "), "var(--e-battery)")] : []),
    ];
  });

  // The first week: what is already there and when the rest fills in.
  const filling = $derived.by(() => {
    const days = h.today;
    const on = (d: number) => fmtDay(h, d);
    return [
      { done: true, text: "Tages- und Wochenverlauf", when: `seit ${on(0)}` },
      { done: days >= 3, text: "Korrektur je MPPT-Eingang", when: days >= 3 ? "lernt seit 3 Tagen" : `ab ${on(3)}` },
      { done: days >= 7, text: "Vergleich mit der Vorwoche", when: `ab ${on(7)}` },
      { done: false, text: "Batteriezustand", when: "nach den ersten vollständigen Entladungen" },
      { done: false, text: "Amortisationsprognose", when: `ab ${fmtDay(h, 90, true)}` },
      { done: false, text: "Jahresvergleich", when: `ab ${fmtDay(h, 365, true)}` },
    ];
  });

  const chartHeight = $derived(input.desktop ? 320 : 232);
</script>

<div class={["mx-auto flex w-full max-w-[1320px] flex-col gap-4 px-3 pt-4 pb-6 sm:px-4 lg:gap-5 lg:px-6 lg:pt-6", motion.still && "still"]}>
  <!-- The range sits on the page's centre line: title left of it, the baseline right. -->
  <header class="flex flex-wrap items-center gap-x-6 gap-y-3 lg:grid lg:grid-cols-[1fr_540px_1fr] lg:items-start">
    <h1 class="order-1 text-xl font-semibold tracking-tight lg:leading-8">Verlauf</h1>
    <div class="order-3 w-full lg:order-2">
      <RangeControl
        kind={sel.kind}
        label={selLabel(h, sel)}
        dir={trip.dir}
        canPrev={canStep(h, sel, -1)}
        canNext={canStep(h, sel, 1)}
        onkind={setKind}
        onstep={stepBy}
        custom={{
          from: iso(dateOf(h.start, sel.from)),
          to: iso(dateOf(h.start, sel.to - 1)),
          min: iso(h.start),
          max: iso(dateOf(h.start, h.today)),
          fromHour: sel.h0 ?? 0,
          toHour: sel.h1 ?? 24,
          onchange: (a, b, u, v) => nav(selParams(h, spanSel(h, toDay(a) * 24 + u, toDay(b) * 24 + v))),
          onall: () => nav(selParams(h, customSel(h, 0, h.today + 1))),
        }}
      />
    </div>
    <!-- The baseline every change on this screen is measured against. -->
    <div class="order-2 ml-auto flex items-center gap-2 text-xs text-muted-foreground lg:order-3 lg:justify-self-end">
      {#if fresh}
        <span>Aufzeichnung seit {fmtDay(h, 0)}</span>
      {:else if sel.kind === "year"}
        <span>Vergleich mit dem Vorjahr</span>
      {:else}
        <span class="max-sm:sr-only">Vergleich mit</span>
        <ToggleGroup.Root
          type="single"
          variant="outline"
          size="sm"
          class="data-indicator:before:hidden!"
          aria-label="Vergleich mit"
          bind:value={() => route.cmp, (v: string) => {
            if (!v || v === route.cmp) return;
            haptics.selection();
            nav({ cmp: v === "year" ? "year" : null });
          }}
        >
          <span class="pill" {@attach indicator('[data-state="on"]')}></span>
          <ToggleGroup.Item value="prev" class="px-2.5 text-xs">{prevLabel}</ToggleGroup.Item>
          <ToggleGroup.Item value="year" class="px-2.5 text-xs">Vorjahr</ToggleGroup.Item>
        </ToggleGroup.Root>
      {/if}
    </div>
  </header>

  <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6">
    <!-- A finger anywhere on the card but its chart drags the range, so the thumb need not reach the arrows. -->
    <div class="edge min-w-0 self-start" {@attach edge(flow)}>
      <Card.Root class="glass-ambient @container gap-0 py-0" {@attach (node: HTMLElement) => pager?.swipe(node)}>
        <!-- The range's answer: four figures, each the door to its own view. -->
        <div class="relative grid grid-cols-4 divide-x divide-border/60 border-b border-border/60" role="tablist" aria-label="Frage">
          {#each figures as f (f.id)}
            {@render figure(f.id, f.label)}
          {/each}
          {@render figure("plant", "Anlage")}
          <!-- Which view is open: the brand marks the control, never the data. -->
          <span class="bg-brand" {@attach indicator('[aria-selected="true"]', 2)}></span>
        </div>

        {#if status === "error"}
          <div class="flex min-h-[420px] flex-col items-start justify-center gap-3 px-5 py-8 sm:px-8" role="alert">
            <TriangleAlert class="size-5 text-warning" />
            <h2 class="text-base font-semibold">Der Verlauf konnte nicht geladen werden</h2>
            <p class="max-w-[52ch] text-sm text-muted-foreground">Der Core hat nach 10 s nicht geantwortet. Live-Werte laufen weiter; Zeitraum und Ansicht bleiben, wie sie sind.</p>
            <Button onclick={() => { haptics.light(); retried = true; }}>Erneut laden</Button>
          </div>
        {:else}
          <div class="flex flex-col gap-3 px-3 pt-4 pb-4 sm:px-5">
            <div class="min-h-[3rem] @[640px]:min-h-[2rem]">
              {#if loading}
                <Skeleton class="mt-1 h-5 w-4/5" />
              {:else}
                <!-- The sentence changes with the question and the range; a live tick only rewrites it. -->
                <Pager id="{trip.key}|{route.metric}|{route.cmp}" data={{ verdict, gapHours }} travel={() => ({ kind: "shift", dir: 0 })} after={110}>
                  {#snippet children(d)}
                    <p class="max-w-[62ch] text-base leading-6 font-medium text-pretty @[640px]:text-lg">
                      {d.verdict}{#if d.gapHours > 0 && route.metric !== "plant"}<span class="text-sm font-normal text-muted-foreground">{" "}{num(d.gapHours)} h ohne Daten.</span>{/if}
                    </p>
                  {/snippet}
                </Pager>
              {/if}
            </div>

            <Pager id={route.metric} data={tabs} travel={() => ({ kind: "shift", dir: metricSide })}>
              {#snippet children(list)}
                <Tabs.Root
                  bind:value={() => route.tab, (v: string) => {
                    if (v === route.tab) return;
                    haptics.selection();
                    nav({ tab: v === tabs[0]!.id ? null : v });
                  }}
                >
                  <Tabs.List variant="line" class="-ml-1.5 data-indicator:before:hidden!">
                    {#each list as t (t.id)}
                      <Tabs.Trigger value={t.id}>{t.label}</Tabs.Trigger>
                    {/each}
                    <span class="bg-foreground" {@attach indicator('[data-state="active"]', 2)}></span>
                  </Tabs.List>
                </Tabs.Root>
              {/snippet}
            </Pager>

            <div class="min-h-[348px] lg:min-h-[416px]">
              <Pager bind:this={pager} id={paneId(sel)} data={pane} {travel} {peek} defer onstep={(dir) => (haptics.selection(), stepBy(dir, true))}>
                {#snippet children(d)}
                  {#if d.tab === "time"}
                    <TimePanel q={d.q} height={chartHeight} />
                  {:else if d.tab === "years"}
                    <YearsPanel q={d.q} height={chartHeight - 40} />
                  {:else if d.tab === "pattern"}
                    <PatternPanel q={d.q} />
                  {:else if d.tab === "forecast"}
                    <ForecastPanel q={d.q} height={chartHeight - 40} />
                  {:else if d.tab === "tariff"}
                    <TariffPanel q={d.q} height={chartHeight - 60} />
                  {:else if d.tab === "payback"}
                    <PaybackPanel q={d.q} {pay} height={chartHeight - 60} />
                  {:else if d.tab === "strings"}
                    <StringsPanel q={d.q} rows={d.rows} sid={route.sid} onpick={(id) => nav({ sid: id })} />
                  {:else if d.tab === "battery"}
                    <BatteryPanel q={d.q} height={chartHeight - 60} />
                  {:else}
                    <DataPanel q={d.q} />
                  {/if}
                {/snippet}
              </Pager>
            </div>
          </div>
        {/if}
      </Card.Root>
    </div>

    {#if status !== "error"}
      <aside class="grid content-start gap-4 sm:max-lg:grid-cols-2">
        <!-- Each box follows the one above it, and its own bottom edge travels when its content changes. -->
        <div class="edge" {@attach edge(flow)} {@attach flow.track}>
          <section class="glass-ambient overflow-hidden rounded-lg ring-1 ring-foreground/10" aria-label="Aufschlüsselung">
            <h2 class="px-4 pt-3 pb-2 text-sm font-semibold">Aufschlüsselung <span class="font-normal text-muted-foreground">· {selLabel(h, sel)}</span></h2>
            <Pager id={route.metric} data={breakdown} travel={() => ({ kind: "shift", dir: metricSide })}>
              {#snippet children(list)}
                <dl class="divide-y divide-border/60 border-t border-border/60">
                  {#each list as r (r.label)}
                    <div class={["flex items-baseline gap-2 px-4 py-2", r.indent && "pl-8"]}>
                      {#if r.colour}<span class="size-2 shrink-0 rounded-[1px]" style:background={r.colour}></span>{/if}
                      <dt class="min-w-0 flex-1 text-sm">
                        {r.label}
                        {#if r.sub}
                          <span class="block text-xs text-muted-foreground tabular-nums">
                            {#if loading}&nbsp;{:else if typeof r.sub === "string"}{r.sub}{:else}<AnimatedNumber value={r.sub.value} format={r.sub.fmt} duration={320} appear={false} />{/if}
                          </span>
                        {/if}
                      </dt>
                      <dd class="text-sm font-semibold whitespace-nowrap tabular-nums"><AnimatedNumber value={loading ? null : r.value} format={r.fmt} placeholder="–" duration={320} appear={false} /></dd>
                    </div>
                  {/each}
                </dl>
                {#if list === breakdown && route.metric === "money"}
                  <p class="border-t border-border/60 px-4 py-2 text-xs text-muted-foreground tabular-nums">Tarif: Bezug {num(p.imp, 1)} ct · Einspeisung {num(p.feedIn, 1)} ct je kWh</p>
                {/if}
              {/snippet}
            </Pager>
          </section>
        </div>

        {#if hints.length && !loading}
          <div class="edge" {@attach edge(flow)} {@attach flow.track}>
            <section class="glass-ambient rounded-lg ring-1 ring-foreground/10" aria-label="Auffälligkeiten">
              <h2 class="px-4 pt-3 pb-2 text-sm font-semibold">Auffälligkeiten</h2>
              <ul class="divide-y divide-border/60 border-t border-border/60">
                {#each hints as n (n.text)}
                  <li>
                    <button type="button" class="row flex w-full items-start gap-2.5 px-4 py-2.5 text-left" onclick={() => (n.sel ? open(n.sel) : view(n.view!.metric as Metric, n.view!.tab as Tab))}>
                      {#if n.tone === "warn"}<TriangleAlert class="mt-0.5 size-4 shrink-0 text-warning" />{:else}<Info class="mt-0.5 size-4 shrink-0 text-muted-foreground" />{/if}
                      <span class="min-w-0 flex-1 text-sm text-pretty">{n.text}<span class="mt-0.5 block text-xs font-medium text-brand">{n.action}</span></span>
                      <ChevronRight class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                {/each}
              </ul>
            </section>
          </div>
        {/if}

        {#if fresh}
          <div {@attach flow.track}>
            <section class="glass-ambient rounded-lg ring-1 ring-foreground/10" aria-label="Was sich noch füllt">
              <h2 class="px-4 pt-3 text-sm font-semibold">Der Verlauf füllt sich</h2>
              <p class="px-4 pt-1 pb-2 text-xs text-muted-foreground">Aufgezeichnet wird seit {fmtDay(h, 0)}. Das kommt dazu:</p>
              <ul class="divide-y divide-border/60 border-t border-border/60">
                {#each filling as f (f.text)}
                  <li class="flex items-start gap-2.5 px-4 py-2 text-sm">
                    {#if f.done}<Check class="mt-0.5 size-4 shrink-0 text-success" />{:else}<Circle class="mt-0.5 size-4 shrink-0 text-muted-foreground/60" />{/if}
                    <span class={["flex-1", !f.done && "text-muted-foreground"]}>{f.text}<span class="block text-xs text-muted-foreground">{f.when}</span></span>
                  </li>
                {/each}
              </ul>
              <div class="border-t border-border/60 p-3">
                <Button variant="outline" size="sm" class="w-full">Verlauf aus SunReye 3 importieren</Button>
              </div>
            </section>
          </div>
        {:else}
          <!-- Stored value: every day moves this bar. On the payback tab the tab itself says it: it fades, its place stays. -->
          {@const tucked = route.metric === "money" && route.tab === "payback"}
          <div class={["tuck", tucked && "tucked"]} inert={tucked} {@attach flow.track}>
            <button type="button" class="glass-ambient flex w-full flex-col gap-2 rounded-lg px-4 py-3 text-left ring-1 ring-foreground/10 outline-none transition-shadow hover:ring-foreground/25 focus-visible:ring-2 focus-visible:ring-ring" onclick={() => view("money", "payback")}>
              <span class="flex w-full items-baseline justify-between gap-2">
                <span class="text-sm font-semibold">Amortisation</span>
                <span class="text-sm font-semibold tabular-nums"><AnimatedNumber value={loading ? null : pay.share} format={percentTo} placeholder="–" duration={320} appear={false} /></span>
              </span>
              <Progress value={loading ? 0 : pay.share * 100} size="square" class="payback" aria-label="Amortisation" />
              <span class="text-xs text-muted-foreground tabular-nums">
                {#if loading}&nbsp;{:else}{money(pay.saved)} von {money(h.investment)} gespart{#if pay.reached}, erreicht voraussichtlich {pay.reached.getFullYear()}{/if}{/if}
              </span>
            </button>
          </div>
        {/if}
      </aside>
    {/if}
  </div>
</div>

{#snippet figure(id: Metric, label: string)}
  {@const on = route.metric === id}
  {@const f = figures.find((x) => x.id === id)}
  {@const quiet = loading || status === "error"}
  <button
    type="button"
    role="tab"
    aria-selected={on}
    class={["figure relative flex min-w-0 flex-col items-start gap-1 px-2 pt-3 pb-3 text-left sm:px-4", on && "on"]}
    onclick={() => {
      if (on) return;
      haptics.selection();
      nav({ metric: id === "energy" ? null : id, tab: null });
    }}
  >
    <span class={["label max-w-full truncate text-xs font-medium", on ? "text-foreground" : "text-muted-foreground"]}>{label}</span>
    <span class="flex max-w-full items-baseline gap-1 text-lg leading-none font-semibold tracking-tight whitespace-nowrap tabular-nums @[640px]:text-3xl">
      {#if f}
        <AnimatedNumber value={quiet ? null : f.value} format={f.fmt} placeholder="–" duration={320} appear={false} />
        <span class="text-[10px] font-medium tracking-normal text-muted-foreground @[640px]:text-sm">{f.unit}</span>
      {:else}
        {#if !quiet && !learning}
          {#if warnings}<TriangleAlert class="size-4 shrink-0 self-center text-warning @[640px]:size-5" />{:else}<CircleCheck class="size-4 shrink-0 self-center text-success @[640px]:size-5" />{/if}
        {/if}
        {quiet || learning ? "–" : warnings ? String(warnings) : "OK"}
        <span class="text-[10px] font-medium tracking-normal text-muted-foreground @[640px]:text-sm">{warnings ? (warnings === 1 ? "Hinweis" : "Hinweise") : ""}</span>
      {/if}
    </span>
    <span class="max-w-full truncate text-xs text-muted-foreground tabular-nums">
      {#if f && base && !quiet}
        <span class="font-medium text-foreground"><AnimatedNumber value={f.change} format={(v) => delta(v, f.points)} placeholder="–" duration={320} appear={false} /></span><span class="hidden @[640px]:inline">{" "}{base.against}</span>
      {:else if !f}
        <span class="@[640px]:hidden">{learning ? "lernt noch" : "Zustand"}</span><span class="hidden @[640px]:inline">{h.batteryFrom === null ? "Strings, Daten" : "Strings, Batterie, Daten"}</span>
      {:else}&nbsp;{/if}
    </span>
  </button>
{/snippet}

<style>
  /* Room for the card's shadow while its bottom edge travels behind a clip. */
  .edge {
    margin: -12px -12px -1px;
    padding: 12px 12px 1px;
  }
  .figure,
  .row {
    outline: none;
    transition: background-color 120ms var(--motion-ease);
  }
  .figure.on {
    background-color: color-mix(in oklab, var(--foreground) 5%, transparent);
  }
  .figure:hover,
  .row:hover {
    background-color: color-mix(in oklab, var(--foreground) 4%, transparent);
  }
  .figure.on:hover {
    background-color: color-mix(in oklab, var(--foreground) 7%, transparent);
  }
  .figure:active,
  .row:active {
    background-color: color-mix(in oklab, var(--foreground) 8%, transparent);
  }
  .figure:focus-visible,
  .row:focus-visible {
    box-shadow: inset 0 0 0 2px var(--ring);
  }
  .pill {
    border-radius: 2px;
    background: color-mix(in oklab, var(--foreground) 13%, transparent);
  }
  .tuck {
    transition: opacity 200ms var(--motion-ease);
  }
  .tucked {
    opacity: 0;
    transition: opacity 150ms ease-in;
  }
  .still :is(.figure, .row, .tuck) {
    transition: none;
  }
  :global(.payback > [data-slot="progress-indicator"]) {
    background: var(--e-solar);
  }
</style>

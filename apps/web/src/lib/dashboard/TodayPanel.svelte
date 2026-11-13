<!--
  Today's energy (ADR 21) as one surface: the four figures with their money, the autarky and
  self-consumption meters and the day curve, divided by hairlines. Every part opens its detail.
-->
<script lang="ts">
  import { flowColour } from "../energy-colours.ts";
  import * as Card from "#lib/components/ui/card/index.js";
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";
  import AnimatedNumber from "../components/animated-number.svelte";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";
  import { formatPower } from "../power.ts";
  import type { Day } from "./day.ts";
  import DayChart from "./DayChart.svelte";
  import Meter from "./Meter.svelte";

  let {
    tariff,
    day,
    onopen,
  }: {
    /** The tariff's values: `price.import` and `price.export` in EUR/kWh (ADR 12). */
    tariff: Readonly<Record<string, number>> | undefined;
    day: Day | undefined;
    onopen: (id: string) => void;
  } = $props();

  const locale = getLocale();

  const eur = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });

  const tenths = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  /** The plant-local clock: today is cut in the plant's zone, whatever the viewer's. */
  const clock = $derived(
    new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: day?.zone }),
  );

  /** Holds a line's height while there is nothing to say. */
  const BLANK = "\u00A0";

  type Kind = "production" | "consumption" | "feedIn" | "purchase";

  function peak(kind: "production" | "consumption"): string {
    const at = day?.today.peaks[kind] ?? null;

    return at === null
      ? BLANK
      : m.dash_peak({ power: formatPower(at.watts), time: clock.format(at.at) });
  }

  /** The money a flow earned or cost today, and the price per kWh now. */
  function priced(
    write: typeof m.dash_earned,
    side: "earned" | "paid",
    price: "price.export" | "price.import",
  ): string {
    const money = day?.money ?? null;
    const now = tariff?.[price];

    return money === null
      ? BLANK
      : write({
          money: eur.format(money[side]),
          price: now === undefined ? "–" : tenths.format(now * 100),
        });
  }

  const value = (kind: Kind) => day?.today[kind] ?? null;

  const figures = $derived([
    {
      id: "production",
      label: m.dash_made(),
      value: value("production"),
      colour: flowColour("solar"),
      sub: peak("production"),
    },
    {
      id: "consumption",
      label: m.dash_used(),
      value: value("consumption"),
      colour: flowColour("house"),
      sub: peak("consumption"),
    },
    {
      id: "feedIn",
      label: m.dash_grid_export(),
      value: value("feedIn"),
      colour: flowColour("export"),
      sub: priced(m.dash_earned, "earned", "price.export"),
    },
    {
      id: "purchase",
      label: m.dash_grid_import(),
      value: value("purchase"),
      colour: flowColour("import"),
      sub: priced(m.dash_paid, "paid", "price.import"),
    },
  ]);

  const press =
    "outline-none transition-colors hover:bg-foreground/[0.04] focus-visible:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-foreground/[0.08]";
</script>

<Card.Root
  size="sm"
  class="glass-ambient @container min-h-0 gap-0 py-0 lg:flex-1"
  role="group"
  aria-label={m.dash_today()}
>
  <div class="flex shrink-0 items-center justify-between gap-3 pl-4">
    <h2 class="text-sm font-semibold">{m.dash_today()}</h2>
    <button
      type="button"
      class="flex items-baseline gap-2 px-4 py-2.5 {press}"
      onclick={() => onopen("saved")}
    >
      <span class="text-xs text-muted-foreground">{m.dash_saved()}</span>
      <span class="text-base font-semibold tabular-nums"
        >{day?.money ? eur.format(day.money.saved) : "–,–– €"}</span
      >
    </button>
  </div>

  <div class="grid shrink-0 grid-cols-2">
    {#each figures as f, i (f.id)}
      <button
        type="button"
        class={[
          "flex min-w-0 flex-col items-start gap-1 border-t border-border/60 px-4 py-3 text-left @[560px]:py-4",
          i % 2 === 1 && "border-l",
          press,
        ]}
        onclick={() => onopen(f.id)}
      >
        <span class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
          ><span class="size-2 rounded-[1px]" style:background={f.colour}></span>{f.label}</span
        >
        <span
          class="text-2xl leading-none font-semibold tracking-tight whitespace-nowrap @[560px]:text-3xl"
        >
          <AnimatedNumber value={f.value} /><span
            class="ml-1 text-sm font-medium text-muted-foreground">kWh</span
          >
        </span>
        <span class="max-w-full truncate text-xs text-muted-foreground tabular-nums">{f.sub}</span>
      </button>
    {/each}
  </div>

  <button
    type="button"
    class="grid shrink-0 grid-cols-2 gap-6 border-t border-border/60 px-4 py-3 text-left {press}"
    onclick={() => onopen("autarky")}
  >
    <Meter label={m.dash_autarky()} value={day?.today.autarky ?? null} colour={flowColour("battery")} />
    <Meter label={m.dash_self_use()} value={day?.today.selfUse ?? null} colour={flowColour("solar")} />
  </button>

  <button
    type="button"
    class="flex min-h-0 flex-col gap-1 border-t border-border/60 px-4 pt-3 pb-2 text-left max-lg:h-52 lg:min-h-[132px] lg:flex-1 {press}"
    onclick={() => onopen("production")}
    aria-label={m.dash_day_details()}
  >
    <span class="flex shrink-0 items-center gap-3 text-xs">
      <span class="font-medium text-muted-foreground">{m.dash_day()}</span>
      <span class="flex items-center gap-1.5 text-muted-foreground"
        ><span class="h-0.5 w-3 bg-solar"></span>{m.dash_actual()}</span
      >
      <span class="flex items-center gap-1.5 text-muted-foreground"
        ><span class="h-0 w-3 border-t border-dashed border-solar"></span>{m.dash_forecast()}</span
      >
      <span class="ml-auto text-muted-foreground">kW</span>
    </span>
    <span class="relative block min-h-0 w-full flex-1">
      {#if day === undefined}
        <Skeleton class="absolute inset-0" role="status" aria-label={m.loading()} />
      {:else}
        <span class="absolute inset-0"
          ><DayChart rows={day.rows} now={day.now} hours={clock} /></span
        >
      {/if}
    </span>
  </button>
</Card.Root>

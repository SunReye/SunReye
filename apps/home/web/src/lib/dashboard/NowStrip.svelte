<!-- The "now" strip (ADR 21): price, PV still to come and the weather, one surface divided by hairlines. -->
<script lang="ts">
  import { Pressable } from "@sunreye/ui/pressable";
  import * as Card from "@sunreye/ui/card";
  import AnimatedNumber from "../components/animated-number.svelte";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";
  import type { Day } from "./day.ts";
  import { priceLevel } from "./now.ts";
  import SkyIcon from "../weather/SkyIcon.svelte";
  import { skyOf } from "../weather/sky.ts";
  import { SKY_WORDS } from "../weather/sky-words.ts";

  let {
    spot,
    tariff,
    day,
    onopen,
  }: {
    /** The spot-price device's values: `price.spot` in EUR/kWh (ADR 12). */
    spot: Readonly<Record<string, number>> | undefined;
    /** The tariff's: `price.import`, what a bought kWh costs. */
    tariff: Readonly<Record<string, number>> | undefined;
    day: Day | undefined;
    onopen: (id: string) => void;
  } = $props();

  // The spot price when the admin chose a zone, else what the tariff charges.
  const spotPrice = $derived(spot?.["price.spot"]);
  const price = $derived(spotPrice ?? tariff?.["price.import"]);

  /** Holds a line's height while there is nothing to say. */
  const BLANK = "\u00A0";

  const priceLabel = $derived(
    spotPrice === undefined && price !== undefined ? m.dash_price() : m.dash_spot(),
  );

  const cents = $derived(price === undefined ? null : price * 100);

  // The word carries the judgement; the colour only repeats it.
  const LEVELS = {
    cheap: { word: m.dash_cheap, cls: "text-success" },
    normal: { word: m.dash_normal, cls: "text-muted-foreground" },
    dear: { word: m.dash_dear, cls: "text-warning" },
  };

  const level = $derived(
    spotPrice === undefined || day === undefined
      ? null
      : priceLevel(
          spotPrice,
          day.prices.map((p) => p.value),
        ),
  );

  const levelWord = $derived(level === null ? BLANK : LEVELS[level].word());

  const levelClass = $derived(level === null ? "" : LEVELS[level].cls);

  const tenths = new Intl.NumberFormat(getLocale(), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  const remaining = $derived(day?.pv.remaining ?? null);

  const pvOf = $derived(
    day === undefined ? BLANK : m.dash_pv_of({ total: tenths.format(day.pv.total) }),
  );

  const celsius = $derived(day?.weather.celsius ?? null);

  const sky = $derived(day === undefined ? null : skyOf(day.weather));

  const cell = "flex min-w-0 flex-col items-start gap-0.5 px-3 py-3 text-left sm:px-4";

  const label = "max-w-full truncate text-xs font-medium text-muted-foreground";
  const figure = "text-xl leading-tight font-semibold tracking-tight whitespace-nowrap";
  const unit = "text-xs font-medium text-muted-foreground";
  const sub = "max-w-full truncate text-xs text-muted-foreground";
</script>

<Card.Root
  size="sm"
  class="grid shrink-0 grid-cols-3 gap-0 divide-x divide-border/60 py-0"
  role="group"
  aria-label={m.dash_now()}
>
  <Pressable feedback class={cell} onclick={() => onopen("price")}>
    <span class={label}>{priceLabel}</span>
    <!-- A currency subunit symbol, the same in every locale. -->
    <span class={figure}>
      <AnimatedNumber value={cents} />
      <span class={unit}>ct/kWh</span>
    </span>
    <span class="{sub} {levelClass}">{levelWord}</span>
  </Pressable>
  <Pressable feedback class={cell} onclick={() => onopen("forecast")}>
    <span class={label}>{m.dash_pv_left()}</span>
    <span class={figure}><AnimatedNumber value={remaining} /> <span class={unit}>kWh</span></span>
    <span class={sub}>{pvOf}</span>
  </Pressable>
  <Pressable feedback class={cell} onclick={() => onopen("weather")}>
    <span class={label}>{m.dash_weather()}</span>
    <span class={figure}>
      <AnimatedNumber value={celsius} digits={0} />
      <span class={unit}>°C</span>
    </span>
    <span class="{sub} flex items-center gap-1">
      {#if sky === null}
        {BLANK}
      {:else}
        <SkyIcon {sky} class="size-3.5 shrink-0" />
        <span class="truncate">{SKY_WORDS[sky]()}</span>
      {/if}
    </span>
  </Pressable>
</Card.Root>

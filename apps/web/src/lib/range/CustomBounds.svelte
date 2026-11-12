<!-- A custom range's two bounds, each a date and an hour; the end's hour 24 is the end of its day. -->
<script lang="ts">
  import { Input } from "#lib/components/ui/input/index.js";
  import { m } from "../paraglide/messages.js";
  import type { Bounds } from "./range.ts";

  let { custom: c }: { custom: Bounds } = $props();

  const HOURS = Array.from({ length: 25 }, (_, i) => i);

  const select =
    "h-8 rounded-md border border-input bg-transparent px-1.5 text-xs tabular-nums outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

  /** One bound: its date between its limits, its hour, and how either changes the range. */
  interface Side {
    text: string;
    date: string;
    min: string;
    max: string;
    hour: number;
    hours: number[];
    setDate: (date: string) => void;
    setHour: (hour: number) => void;
  }

  const sides = $derived<Side[]>([
    {
      text: m.range_from(),
      date: c.from,
      min: c.min,
      max: c.to,
      hour: c.fromHour,
      hours: HOURS.slice(0, 24),
      setDate: (date) => c.onchange(date, c.to, c.fromHour, c.toHour),
      setHour: (hour) => c.onchange(c.from, c.to, hour, c.toHour),
    },
    {
      text: m.range_to(),
      date: c.to,
      min: c.from,
      max: c.max,
      hour: c.toHour,
      hours: HOURS.slice(1),
      setDate: (date) => c.onchange(c.from, date, c.fromHour, c.toHour),
      setHour: (hour) => c.onchange(c.from, c.to, c.fromHour, hour),
    },
  ]);
</script>

<div class="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs">
  {#each sides as side (side.text)}
    <div class="flex items-center gap-1.5">
      <span class="w-6 text-muted-foreground">{side.text}</span>
      <Input
        type="date"
        class="h-8 w-[9.5rem] text-xs"
        aria-label={m.range_date({ bound: side.text })}
        value={side.date}
        min={side.min}
        max={side.max}
        onchange={(e) => {
          if (e.currentTarget.value) side.setDate(e.currentTarget.value);
        }}
      />
      <select
        class={select}
        aria-label={m.range_time({ bound: side.text })}
        value={side.hour}
        onchange={(e) => side.setHour(Number(e.currentTarget.value))}
      >
        {#each side.hours as hr (hr)}
          <option value={hr}>{m.range_hour({ hour: hr })}</option>
        {/each}
      </select>
    </div>
  {/each}
</div>

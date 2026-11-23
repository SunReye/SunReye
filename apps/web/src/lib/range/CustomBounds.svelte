<!-- A custom range's two bounds, each a date and an hour; the end's hour 24 is the end of its day. -->
<script lang="ts">
  import DateField from "@sunreye/builder/components/date-field.svelte";
  import SelectField from "../components/select-field.svelte";
  import { m } from "../paraglide/messages.js";
  import type { Bounds } from "./range.ts";

  let { custom: c }: { custom: Bounds } = $props();

  const HOURS = Array.from({ length: 25 }, (_, i) => i);

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
      <DateField
        class="w-[9.5rem] text-xs"
        label={m.range_date({ bound: side.text })}
        value={side.date}
        min={side.min}
        max={side.max}
        onchange={side.setDate}
      />
      <SelectField
        size="sm"
        class="text-xs"
        label={m.range_time({ bound: side.text })}
        value={String(side.hour)}
        options={side.hours.map((hr) => ({ value: String(hr), label: m.range_hour({ hour: hr }) }))}
        onchange={(hour) => {
          side.setHour(Number(hour));
        }}
      />
    </div>
  {/each}
</div>

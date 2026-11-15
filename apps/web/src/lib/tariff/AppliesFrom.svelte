<!-- When a tariff change applies: from now, or from midnight of a day picked on the calendar. -->
<script lang="ts">
  import CalendarDays from "@lucide/svelte/icons/calendar-days";
  import { parseDate, type DateValue } from "@internationalized/date";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Calendar } from "#lib/components/ui/calendar/index.js";
  import * as Item from "#lib/components/ui/item/index.js";
  import * as Popover from "#lib/components/ui/popover/index.js";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";

  /** `YYYY-MM-DDT00:00`, the plant's midnight; empty for now. */
  let { value = $bindable() }: { value: string } = $props();

  let open = $state(false);

  const day = $derived(value === "" ? undefined : parseDate(value.slice(0, 10)));

  const shown = new Intl.DateTimeFormat(getLocale(), { dateStyle: "medium" });

  function pick(next: DateValue | undefined): void {
    value = next === undefined ? "" : `${next.toString()}T00:00`;
    open = false;
  }
</script>

<Popover.Root bind:open>
  <Item.Root class="rounded-none border-0">
    {#snippet child({ props })}
      <Popover.Trigger
        {...props}
        class={[props.class, "flex-nowrap text-left hover:bg-muted/60 active:bg-muted"]}
      >
        <Item.Content class="min-w-0">
          <Item.Title class="text-[15px] font-normal">{m.tariff_applies_from()}</Item.Title>
        </Item.Content>
        <Item.Actions class="gap-2 text-[15px] font-medium tabular-nums">
          {day === undefined ? m.tariff_now() : shown.format(new Date(`${value}`))}
          <CalendarDays class="size-4 text-muted-foreground" />
        </Item.Actions>
      </Popover.Trigger>
    {/snippet}
  </Item.Root>
  <Popover.Content class="w-auto p-0" align="end">
    <Calendar
      type="single"
      {...day === undefined ? {} : { value: day }}
      onValueChange={pick}
      locale={getLocale()}
    />
    <div class="border-t border-border/60 p-2">
      <Button variant="ghost" size="sm" class="w-full" onclick={() => pick(undefined)}>
        {m.tariff_now()}
      </Button>
    </div>
  </Popover.Content>
</Popover.Root>

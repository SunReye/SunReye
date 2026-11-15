<script lang="ts">
  import { CalendarDate } from "@internationalized/date";
  import { Calendar } from "../../components/ui/calendar/index.js";
  import { RangeCalendar } from "../../components/ui/range-calendar/index.js";
  import Demo from "../Demo.svelte";

  let day = $state(new CalendarDate(2026, 11, 13));
  let span = $state({ start: new CalendarDate(2026, 11, 9), end: new CalendarDate(2026, 11, 13) });
</script>

<Demo name="calendar">
  <Calendar type="single" bind:value={day} locale="en-GB" class="border" />
</Demo>

<Demo name="range-calendar">
  <RangeCalendar bind:value={span} locale="en-GB" class="border" />
</Demo>

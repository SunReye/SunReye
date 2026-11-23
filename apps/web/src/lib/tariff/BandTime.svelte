<!-- A band's start or end as a button that opens the value editor's time wheels (ADR 21). -->
<script lang="ts">
  import Clock from "@lucide/svelte/icons/clock";
  import { Button } from "@sunreye/ui/button";
  import { clock, type Editable, type Outcome } from "../components/value-editor/editable.ts";
  import ValueEditor from "../components/value-editor/value-editor.svelte";

  let {
    label,
    value = $bindable(),
    end = false,
  }: {
    label: string;
    /** `HH:MM`; an end may be 24:00. */
    value: string;
    /** An end: 00:00 on the wheels is the day's end, 24:00, since a band ends after it starts. */
    end?: boolean;
  } = $props();

  // Quarter hours, as spot slots and time-of-use tariffs run.
  const edit = $derived<Editable>({
    kind: "time",
    name: label,
    min: 0,
    max: 24 * 60 - 15,
    step: 15,
  });

  const minutes = $derived.by(() => {
    const [h = 0, mm = 0] = value.split(":").map(Number);

    return (h * 60 + mm) % (24 * 60);
  });

  let anchor = $state<HTMLButtonElement | null>(null);
  let open = $state(false);

  // A draft edit cannot be refused: the editor closes on it at once.
  function apply(next: number): Promise<Outcome> {
    value = end && next === 0 ? "24:00" : clock(next);

    return Promise.resolve({ kind: "confirmed" });
  }
</script>

<Button
  bind:ref={anchor}
  variant="outline"
  aria-haspopup="dialog"
  class="w-full justify-start tabular-nums"
  onclick={() => {
    open = true;
  }}
>
  <Clock class="text-muted-foreground" />
  <span class="text-muted-foreground">{label}</span>
  {value}
</Button>
<ValueEditor key={label} {edit} current={minutes} {anchor} bind:open onapply={apply} />

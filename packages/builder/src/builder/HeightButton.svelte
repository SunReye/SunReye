<!--
  A height on the tracing bar (ADR 20): its name and metres, a press opening the value editor
  (ADR 21); applying gives the height.
-->
<script lang="ts">
  import { Button } from "@sunreye/ui/button";
  import type { Outcome } from "../components/value-editor/editable.ts";
  import ValueEditor from "../components/value-editor/value-editor.svelte";
  import { getLocale } from "../paraglide/runtime.js";
  import { metres } from "./fields.ts";

  let {
    name,
    value,
    onchange,
  }: {
    name: string;
    /** Metres; undefined before any is given. */
    value: number | undefined;
    onchange: (value: number) => void;
  } = $props();

  let button = $state<HTMLButtonElement | null>(null);
  let open = $state(false);

  const edit = $derived(metres(name, 0, 60, 0.05));

  const format = $derived(new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 2 }));

  // A draft edit cannot be refused: the editor closes on it at once.
  function apply(next: number): Promise<Outcome> {
    onchange(next);

    return Promise.resolve({ kind: "confirmed" });
  }
</script>

<Button
  variant="outline"
  size="sm"
  bind:ref={button}
  aria-haspopup="dialog"
  onclick={() => {
    open = true;
  }}
>
  {name}
  <span class="font-medium tabular-nums">{format.format(value ?? 0)} m</span>
</Button>
<ValueEditor
  key={name}
  {edit}
  current={value ?? 0}
  anchor={button}
  bind:open
  onapply={apply}
  below
/>

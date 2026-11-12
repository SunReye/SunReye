<!-- A number's large rolling digits; a tap types the value instead (ADR 21). -->
<script lang="ts">
  import { Button } from "#lib/components/ui/button/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import { m } from "../../paraglide/messages.js";
  import type { Editable, Rows } from "./editable.ts";
  import RollingNumber from "./rolling-number.svelte";

  let {
    edit,
    rows,
    index = $bindable(0),
    live,
    nf,
    text,
  }: {
    edit: Extract<Editable, { kind: "number" }>;
    rows: Rows;
    index?: number;
    /** The fractional row while the wheel moves. */
    live: number;
    nf: Intl.NumberFormat;
    /** The value with its unit. */
    text: string;
  } = $props();

  const parts = $derived(nf.formatToParts(1234.5));
  const group = $derived(parts.find((p) => p.type === "group")?.value ?? "");
  const decimal = $derived(parts.find((p) => p.type === "decimal")?.value ?? ".");

  // A step of 10, 100 … rolls the digits above it and keeps its zeros still.
  const p10 = $derived(edit.step >= 10 && Number.isInteger(Math.log10(edit.step)) ? edit.step : 1);

  const whole = $derived(Number.isInteger(edit.step));

  let typing = $state(false);
  let typed = $state("");

  function commitTyped(): void {
    typing = false;

    const n = Number(typed.replaceAll(group, "").replace(decimal, "."));

    if (Number.isFinite(n) && typed.trim() !== "") index = rows.index(n);
  }

  function focusSelect(node: HTMLInputElement) {
    node.focus();
    node.select();
  }
</script>

{#if typing}
  <Input
    {@attach focusSelect}
    bind:value={typed}
    inputmode="decimal"
    class="h-16 w-40 text-center text-5xl! font-semibold tracking-tight tabular-nums"
    onkeydown={(e) => {
      if (e.key === "Enter") commitTyped();

      if (e.key === "Escape") {
        e.stopPropagation();
        typing = false;
      }
    }}
    onblur={commitTyped}
    aria-label={m.editor_type({ name: edit.name })}
  />
{:else}
  <Button
    variant="ghost"
    class="h-16 items-baseline gap-2 px-3 text-5xl font-semibold tracking-tight"
    onclick={() => {
      typed = nf.format(rows.at(index));
      typing = true;
    }}
    aria-label={m.editor_tap({ value: text })}
  >
    {#if whole}
      <span class="flex"
        ><RollingNumber
          value={(rows.at(0) + live * edit.step) / p10}
          max={edit.max / p10}
        />{#if p10 > 1}<span class="tabular-nums">{"0".repeat(Math.log10(p10))}</span>{/if}</span
      >
    {:else}
      <span class="tabular-nums">{nf.format(rows.at(index))}</span>
    {/if}
    <span class="text-xl font-medium text-muted-foreground">{edit.unit}</span>
  </Button>
{/if}

<!-- The value editor's body (ADR 21): header with rolling digits, wheel or list, apply. -->
<script lang="ts">
  import { Button } from "#lib/components/ui/button/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import { haptics } from "../../haptics.ts";
  import { m } from "../../paraglide/messages.js";
  import { getLocale } from "../../paraglide/runtime.js";
  import ApplyBar from "./apply-bar.svelte";
  import { fits, wheel, type Editable, type Outcome } from "./editable.ts";
  import EnumList from "./enum-list.svelte";
  import RollingNumber from "./rolling-number.svelte";
  import Wheel from "./wheel.svelte";

  let {
    edit,
    current,
    onapply,
    compact = false,
  }: {
    edit: Editable;
    /** The device's value; `null` when unknown. */
    current: number | null;
    onapply: (value: number) => Promise<Outcome>;
    compact?: boolean;
  } = $props();

  // The editor is keyed by its setting; it edits the one it opened with.
  // svelte-ignore state_referenced_locally
  const orig = edit;

  // svelte-ignore state_referenced_locally
  const now = current;

  haptics.nudge();

  const nf = new Intl.NumberFormat(getLocale());
  const parts = nf.formatToParts(1234.5);
  const group = parts.find((p) => p.type === "group")?.value ?? "";
  const decimal = parts.find((p) => p.type === "decimal")?.value ?? ".";

  // Numbers.
  const rows = orig.kind === "number" ? wheel(orig) : undefined;
  const start = orig.kind === "number" && rows ? rows.index(now ?? orig.min) : 0;
  let index = $state(start);
  let live = $state(start);

  // A step of 10, 100 … rolls the digits above it and keeps its zeros still.
  const p10 =
    orig.kind === "number" && orig.step >= 10 && Number.isInteger(Math.log10(orig.step))
      ? orig.step
      : 1;

  const whole = orig.kind === "number" && Number.isInteger(orig.step);

  // Enums.
  let choice = $state(orig.kind === "enum" ? (now ?? orig.options[0]?.value ?? 0) : 0);

  const next = $derived(rows ? rows.at(index) : choice);
  const changed = $derived(next !== now);

  function text(value: number | null): string {
    if (value === null) return "";

    if (orig.kind === "enum")
      return orig.options.find((o) => o.value === value)?.text ?? nf.format(value);

    return orig.unit ? `${nf.format(value)} ${orig.unit}` : nf.format(value);
  }

  const nextText = $derived(text(next));

  let typing = $state(false);
  let typed = $state("");

  function commitTyped(): void {
    typing = false;

    if (!rows) return;

    const n = Number(typed.replaceAll(group, "").replace(decimal, "."));

    if (Number.isFinite(n) && typed.trim() !== "") index = rows.index(n);
  }

  function focusSelect(node: HTMLInputElement) {
    node.focus();
    node.select();
  }

  let pending = $state(false);
  let done = $state(false);

  /** A refusal or a mismatch stays beside its cause until the value changes (never a toast). */
  let problem = $state.raw<{ at: number; outcome: Exclude<Outcome, { kind: "confirmed" }> }>();
  const shownProblem = $derived(problem?.at === next ? problem.outcome : undefined);

  async function apply(): Promise<void> {
    haptics.light();
    pending = true;
    const at = next;
    const outcome = await onapply(at);
    pending = false;

    if (outcome.kind === "confirmed") done = true;
    else problem = { at, outcome };
  }
</script>

<div class={["flex flex-col", compact ? "gap-3" : "gap-4"]}>
  <header class="flex flex-col items-center gap-1 text-center">
    <span class="text-sm font-medium">{orig.name}</span>
    {#if orig.kind === "number"}
      <span class="text-xs text-muted-foreground tabular-nums"
        >{m.editor_limits({
          min: nf.format(orig.min),
          max: nf.format(orig.max),
          unit: orig.unit,
          step: nf.format(orig.step),
        })}</span
      >
    {:else}
      <span class="text-xs text-muted-foreground"
        >{m.editor_values({ count: orig.options.length })}</span
      >
    {/if}

    {#if rows && orig.kind === "number"}
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
          aria-label={m.editor_type({ name: orig.name })}
        />
      {:else}
        <Button
          variant="ghost"
          class="h-16 items-baseline gap-2 px-3 text-5xl font-semibold tracking-tight"
          onclick={() => {
            typed = nf.format(next);
            typing = true;
          }}
          aria-label={m.editor_tap({ value: nextText })}
        >
          {#if whole}
            <span class="flex"
              ><RollingNumber
                value={(rows.at(0) + live * orig.step) / p10}
                max={orig.max / p10}
              />{#if p10 > 1}<span class="tabular-nums">{"0".repeat(Math.log10(p10))}</span
                >{/if}</span
            >
          {:else}
            <span class="tabular-nums">{nf.format(next)}</span>
          {/if}
          <span class="text-xl font-medium text-muted-foreground">{orig.unit}</span>
        </Button>
      {/if}
    {:else}
      <span class="flex h-[48px] items-center text-2xl font-semibold tracking-tight"
        >{nextText}</span
      >
    {/if}
  </header>

  <div data-no-drag>
    {#if rows && orig.kind === "number"}
      <Wheel
        {rows}
        bind:index
        current={now === null ? undefined : rows.index(now)}
        format={(value) => nf.format(value)}
        unit={orig.unit}
        ariaLabel={orig.name}
        onlive={(p) => (live = Math.max(0, Math.min(rows.count - 1, p)))}
      />
    {:else if orig.kind === "enum"}
      <EnumList name={orig.name} options={orig.options} {now} bind:choice />
    {/if}
  </div>

  <ApplyBar
    nowText={text(now)}
    {nextText}
    {changed}
    {pending}
    {done}
    problem={shownProblem}
    allowed={fits(orig, next)}
    onapply={apply}
  />
</div>

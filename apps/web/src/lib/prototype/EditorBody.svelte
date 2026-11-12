<!-- PROTOTYPE: value editor body (ADR 21): header with rolling digits, wheel / time wheels / enum list, apply. -->
<script lang="ts">
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Check from "@lucide/svelte/icons/check";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import { Button } from "#lib/components/ui/button/index.js";
  import Wheel from "./Wheel.svelte";
  import RollingNumber from "./RollingNumber.svelte";
  import * as Item from "#lib/components/ui/item/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import { cn } from "#lib/utils.js";
  import { display, hhmm, type Setting } from "./settings";
  import { haptics } from "./haptics";
  import type { Outcome } from "./ValueEditor.svelte";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";

  let {
    setting,
    onapply,
    compact = false,
  }: { setting: Setting; onapply: (value: number | string) => Promise<Outcome>; compact?: boolean } = $props();

  // svelte-ignore state_referenced_locally
  const orig = setting;

  // Numbers.
  const count = orig.kind === "number" ? Math.round((orig.max - orig.min) / orig.step) + 1 : 0;
  let index = $state(orig.kind === "number" ? Math.round((orig.value - orig.min) / orig.step) : 0);
  let live = $state(orig.kind === "number" ? (orig.value - orig.min) / orig.step : 0);
  const p10 = orig.kind === "number" && orig.step >= 10 && Number.isInteger(Math.log10(orig.step)) ? orig.step : 1;
  const nf = new Intl.NumberFormat("de-DE");

  // Times.
  let hour = $state(orig.kind === "time" ? Math.floor(orig.value / 60) : 0);
  let minute = $state(orig.kind === "time" ? (orig.value % 60) / orig.step : 0);
  let liveH = $state(hour);
  let liveM = $state(minute);

  // Enums.
  let choice = $state(orig.kind === "enum" ? orig.value : "");

  const next = $derived.by((): number | string => {
    if (orig.kind === "number") return orig.min + index * orig.step;
    if (orig.kind === "time") return hour * 60 + minute * orig.step;
    if (orig.kind === "enum") return choice;
    return orig.value;
  });
  const changed = $derived(next !== orig.value);
  const nextText = $derived(display({ ...orig, value: next } as Setting));

  let typing = $state(false);
  let typed = $state("");
  function commitTyped(): void {
    typing = false;
    if (orig.kind !== "number") return;
    const n = Number(typed.replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(n)) return;
    index = Math.max(0, Math.min(count - 1, Math.round((n - orig.min) / orig.step)));
  }
  function focusSelect(node: HTMLInputElement) {
    node.focus();
    node.select();
  }

  let pending = $state(false);
  let done = $state(false);
  /** A refusal or a mismatch stays beside its cause until the value changes (never a toast). */
  let problem = $state<{ at: number | string; outcome: Exclude<Outcome, { kind: "confirmed" }> } | null>(null);
  const shownProblem = $derived(problem && problem.at === next ? problem.outcome : null);
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
    <span class="text-sm font-medium">{orig.label}</span>
    {#if orig.kind === "number"}
      <span class="text-xs text-muted-foreground tabular-nums">{nf.format(orig.min)}–{nf.format(orig.max)} {orig.unit} · Schritt {nf.format(orig.step)}</span>
    {:else if orig.kind === "time"}
      <span class="text-xs text-muted-foreground">Minuten in {orig.step}er-Schritten</span>
    {:else if orig.kind === "enum"}
      <span class="text-xs text-muted-foreground">{orig.options.length} Modi</span>
    {/if}

    {#if orig.kind === "number"}
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
          aria-label="{orig.label} eingeben"
        />
      {:else}
        <Button
          variant="ghost"
          class="h-16 items-baseline gap-2 px-3 text-5xl font-semibold tracking-tight"
          onclick={() => {
            typed = String(next);
            typing = true;
          }}
          aria-label="{nextText}, tippen zum Eingeben"
        >
          <span class="flex"><RollingNumber value={(orig.min + live * orig.step) / p10} max={orig.max / p10} />{#if p10 > 1}<span class="tabular-nums">{"0".repeat(Math.log10(p10))}</span>{/if}</span>
          <span class="text-xl font-medium text-muted-foreground">{orig.unit}</span>
        </Button>
      {/if}
    {:else if orig.kind === "time"}
      <span class="flex h-[64px] items-center text-5xl font-semibold tracking-tight">
        <RollingNumber value={liveH} max={23} pad={2} /><span class="-mt-1 px-0.5 text-muted-foreground">:</span><RollingNumber value={liveM * orig.step} max={59} pad={2} />
      </span>
    {:else if orig.kind === "enum"}
      <span class="flex h-[48px] items-center text-2xl font-semibold tracking-tight">{choice}</span>
    {/if}
  </header>

  <div data-no-drag>
    {#if orig.kind === "number"}
      <Wheel
        {count}
        bind:index
        current={Math.round((orig.value - orig.min) / orig.step)}
        label={(i) => nf.format(orig.min + i * orig.step)}
        unit={orig.unit}
        ariaLabel={orig.label}
        onlive={(p) => (live = Math.max(0, Math.min(count - 1, p)))}
      />
    {:else if orig.kind === "time"}
      <div class="flex items-center justify-center gap-2">
        <Wheel class="w-24" marker="dot" count={24} bind:index={hour} current={Math.floor(orig.value / 60)} label={(i) => String(i).padStart(2, "0")} ariaLabel="Stunde" onlive={(p) => (liveH = Math.max(0, Math.min(23, p)))} />
        <span class="text-2xl font-semibold text-muted-foreground">:</span>
        <Wheel class="w-24" marker="dot" count={60 / orig.step} bind:index={minute} current={(orig.value % 60) / orig.step} label={(i) => String(i * orig.step).padStart(2, "0")} ariaLabel="Minute" onlive={(p) => (liveM = Math.max(0, Math.min(60 / orig.step - 1, p)))} />
      </div>
    {:else if orig.kind === "enum"}
      <!-- The registry's list rows: the group slides its accent and bar to the current row. -->
      <Item.Group role="radiogroup" aria-label={orig.label} class="overflow-hidden rounded-md border border-border/60">
        {#each orig.options as o (o.value)}
          <Item.Root variant="list" size="list-sm" aria-current={choice === o.value}>
            {#snippet child({ props })}
              <button
                {...props}
                type="button"
                role="radio"
                aria-checked={choice === o.value}
                onclick={() => {
                  if (choice !== o.value) haptics.selection();
                  choice = o.value;
                }}
                class={cn(props.class as string, "text-left last:border-b-0")}
              >
                <Item.Content>
                  <Item.Title>{o.value}</Item.Title>
                  <Item.Description class="text-xs">{o.hint}</Item.Description>
                </Item.Content>
                <Item.Actions>
                  {#if orig.value === o.value}<span class="text-xs whitespace-nowrap text-muted-foreground">jetzt</span>{/if}
                  {#if choice === o.value}<Check class="size-4 text-primary" />{/if}
                </Item.Actions>
              </button>
            {/snippet}
          </Item.Root>
        {/each}
      </Item.Group>
    {/if}
  </div>

  {#if shownProblem}
    <div class="flex items-start gap-2.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-left text-sm" role="alert">
      <CircleAlert class="mt-0.5 size-4 shrink-0 text-destructive" />
      <p class="flex-1">
        <span class="font-medium">{shownProblem.kind === "refused" ? "Abgelehnt." : "Abweichung."}</span>
        {shownProblem.reason}
        <a href="#/prototype?screen=status" class="whitespace-nowrap text-brand underline-offset-2 hover:underline">Schreibprotokoll</a>
      </p>
    </div>
  {/if}

  <Button
    size="lg"
    class="h-11 w-full text-[15px]"
    disabled={!changed || pending || done || shownProblem !== null}
    onclick={apply}
  >
    {#if pending}
      <LoaderCircle class="animate-spin" /> Wird geschrieben … {nextText}
    {:else if changed && (display(orig) + nextText).length > 16}
      Übernehmen <ArrowRight class="size-4 opacity-70" /> {nextText}
    {:else if changed}
      Übernehmen <span class="opacity-70">{display(orig)}</span> <ArrowRight class="size-4 opacity-70" /> {nextText}
    {:else if done}
      Bestätigt
    {:else}
      Keine Änderung
    {/if}
  </Button>
</div>

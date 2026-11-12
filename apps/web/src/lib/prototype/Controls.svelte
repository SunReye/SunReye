<!--
  PROTOTYPE: drill-in navigation (ADR 21). Tapping a group slides its page in from the right while
  the parent shifts left and dims; ease-in-out ~300 ms, interruptible, edge-swipe back follows the finger.
  From 1024 px the two levels sit side by side instead and nothing slides.
-->
<script lang="ts">
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import Lock from "@lucide/svelte/icons/lock";
  import { toast } from "svelte-sonner";
  import { initialGroups, summary, display, type Group, type Setting } from "./settings";
  import { input } from "./input.svelte";
  import { tween, spring, VelocityTracker } from "./animate";
  import { haptics } from "./haptics";
  import ValueEditor, { type Outcome } from "./ValueEditor.svelte";
  import * as Item from "#lib/components/ui/item/index.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import { cn } from "#lib/utils.js";

  let {
    initial = null,
    initialProgress,
    writes = true,
  }: { initial?: string | null; initialProgress?: number | undefined; /** ADR 7's writes switch; off makes every control read-only. */ writes?: boolean } = $props();

  let groups = $state(initialGroups());
  // svelte-ignore state_referenced_locally
  let child = $state<string | null>(initial);
  // svelte-ignore state_referenced_locally
  let p = $state(initialProgress ?? (initial ? 1 : 0));
  let cancel: (() => void) | undefined;
  let box: HTMLDivElement | undefined = $state();

  const group = $derived(groups.find((g) => g.id === child));
  // Two panes from 1024 px: the group list stays, its settings fill the rest (owner, 2026-11-12).
  const split = $derived(input.desktop);
  const pane = $derived(group ?? groups[0]);

  function to(target: number, velocity?: number): void {
    cancel?.();
    const done = () => {
      cancel = undefined;
      if (target === 0) child = null;
      haptics.soft();
    };
    // A release keeps its velocity; a tap runs the ease-in-out curve from where it is.
    cancel =
      velocity !== undefined
        ? spring(p, target, (v) => (p = v), { stiffness: 300, damping: 32, velocity, precision: 0.001 }, done)
        : tween(p, target, 300 * Math.abs(target - p) + 60, (v) => (p = v), done);
  }

  /** Two-pane: show a group's settings in the right pane; nothing slides. */
  function pick(id: string): void {
    if (child !== id) haptics.selection();
    child = id;
    p = 1;
  }

  function open(id: string): void {
    child = id;
    to(1);
  }

  // Edge swipe back.
  const tracker = new VelocityTracker();
  let swipe: { id: number; x0: number; p0: number; active: boolean } | undefined;
  function down(e: PointerEvent): void {
    if (!child || !box) return;
    const r = box.getBoundingClientRect();
    if (e.clientX - r.left > 28) return;
    swipe = { id: e.pointerId, x0: e.clientX, p0: p, active: false };
    tracker.reset();
  }
  function move(e: PointerEvent): void {
    if (!swipe || e.pointerId !== swipe.id || !box) return;
    const dx = e.clientX - swipe.x0;
    if (!swipe.active && dx > 6) {
      swipe.active = true;
      cancel?.();
      box.setPointerCapture(e.pointerId);
    }
    if (!swipe.active) return;
    p = Math.max(0, Math.min(1, swipe.p0 - dx / box.offsetWidth));
    tracker.push(p);
  }
  function up(e: PointerEvent): void {
    if (!swipe || e.pointerId !== swipe.id) return;
    const was = swipe.active;
    swipe = undefined;
    if (!was) return;
    const v = tracker.velocity();
    to(v < -1.2 || (p < 0.5 && v < 0.6) ? 0 : 1, v);
  }

  // Value editor.
  let editing = $state<Setting | null>(null);
  let anchor = $state<HTMLElement | null>(null);
  let editorOpen = $state(false);
  function edit(s: Setting, el: HTMLElement): void {
    if (s.kind === "info" || !writes) return;
    editing = $state.snapshot(s) as Setting;
    anchor = el;
    editorOpen = true;
    haptics.nudge();
  }

  /**
   * ADR 7's write, faked: pending until the read-back, then one of three outcomes. The prototype
   * refuses an export limit above 10 kW and reads a charge current above 200 A back as 200 A.
   */
  async function apply(value: number | string): Promise<Outcome> {
    const s = editing!;
    const before = display(s);
    await new Promise((r) => setTimeout(r, 1200));
    if (s.id === "exportW" && Number(value) > 10000) {
      haptics.error();
      return { kind: "refused", reason: "Der Wechselrichter lehnt mehr als 10.000 W ab (Grenze des Netzbetreibers)." };
    }
    const landed = s.id === "chargeA" && Number(value) > 200 ? 200 : value;
    for (const g of groups) for (const x of g.settings) if (x.id === s.id) (x as { value: number | string }).value = landed;
    const after = display(groups.flatMap((g) => g.settings).find((x) => x.id === s.id)!);
    if (landed !== value) {
      haptics.error();
      return { kind: "mismatch", reason: `Zurückgelesen wurde ${after}. Der Wechselrichter hat den Wert begrenzt.` };
    }
    haptics.success();
    toast.success(`${s.label}: ${after}`, { description: `Bestätigt vom Wechselrichter · vorher ${before}` });
    return { kind: "confirmed" };
  }
</script>

{#snippet settingRows(g: Group)}
        <Item.Group class="gap-0 divide-y divide-border/60">
          {#each g.settings as s (s.id)}
            {#if s.kind === "info"}
              <Item.Root class="rounded-none border-0">
                <Item.Content><Item.Title class="text-[15px] font-normal">{s.label}</Item.Title></Item.Content>
                <Item.Actions class="text-[15px] whitespace-nowrap text-muted-foreground tabular-nums">{s.value}</Item.Actions>
              </Item.Root>
            {:else}
              <Item.Root class="rounded-none border-0">
                {#snippet child({ props })}
                  <button
                    {...props}
                    type="button"
                    data-setting={s.id}
                    onclick={(e) => edit(s, e.currentTarget)}
                    aria-haspopup={writes ? "dialog" : undefined}
                    aria-disabled={!writes}
                    class={cn(props.class as string, "text-left", writes ? "hover:bg-muted/60 active:bg-muted" : "cursor-default", editorOpen && editing?.id === s.id && "bg-muted")}
                  >
                    <Item.Content><Item.Title class="text-[15px] leading-snug font-normal text-wrap">{s.label}</Item.Title></Item.Content>
                    <Item.Actions class="gap-2">
                      <span class="text-[15px] font-medium whitespace-nowrap tabular-nums">{display(s)}</span>
                      {#if writes}<ChevronRight class="size-4 text-muted-foreground" />{/if}
                    </Item.Actions>
                  </button>
                {/snippet}
              </Item.Root>
            {/if}
          {/each}
        </Item.Group>
{/snippet}

{#snippet heading()}
  <header class="flex items-end justify-between gap-4 px-1">
    <h1 class="text-2xl font-semibold tracking-tight">Steuerung</h1>
    {#if writes}
      <!-- The normal state stays quiet; the exception below gets the weight. -->
      <span class="flex items-center gap-1.5 pb-1 text-xs text-muted-foreground"><ShieldCheck class="size-3.5 text-success" /> Schreiben aktiv</span>
    {/if}
  </header>

  {#if !writes}
    <div class="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm" role="status">
      <Lock class="mt-0.5 size-4 shrink-0 text-warning" />
      <p class="min-w-[200px] flex-1">
        <span class="font-medium">Nur lesen.</span>
        <span class="text-muted-foreground">Der Schreibschalter ist aus, deshalb lässt sich hier nichts ändern.</span>
      </p>
      <Button variant="outline" size="sm" class="ml-7 shrink-0">Einstellungen › Schreiben</Button>
    </div>
  {/if}

{/snippet}

{#if split}
  <!-- Wide screens: both drill-in levels side by side, so the page uses its width and a group is one click away. -->
  <div class="flex w-full flex-col gap-4 py-6 pr-6">
    {@render heading()}
    <div class="grid grid-cols-[minmax(260px,340px)_minmax(0,1fr)] items-start gap-6">
      <nav aria-label="Gruppen" class="glass-ambient overflow-hidden rounded-lg border border-border/60 elevation-1">
        <Item.Group class="gap-0 divide-y divide-border/60">
          {#each groups as g (g.id)}
            <Item.Root class="rounded-none border-0">
              {#snippet child({ props })}
                <button
                  {...props}
                  type="button"
                  aria-current={pane?.id === g.id ? "page" : undefined}
                  onclick={() => pick(g.id)}
                  class={cn(props.class as string, "relative text-left hover:bg-muted/60 active:bg-muted", pane?.id === g.id && "bg-muted")}
                >
                  {#if pane?.id === g.id}<span class="absolute inset-y-0 left-0 w-0.5 bg-brand"></span>{/if}
                  <Item.Media class="size-9 rounded-md bg-foreground/[0.06] text-muted-foreground"><g.icon class="size-[18px]" /></Item.Media>
                  <Item.Content>
                    <Item.Title class="text-[15px]">{g.label}</Item.Title>
                    <Item.Description class="truncate tabular-nums">{summary(g)}</Item.Description>
                  </Item.Content>
                </button>
              {/snippet}
            </Item.Root>
          {/each}
        </Item.Group>
      </nav>

      {#if pane}
        <section aria-label={pane.label} class="glass-ambient overflow-hidden rounded-lg border border-border/60 elevation-1">
          <h2 class="border-b border-border/60 px-4 py-3 text-[15px] font-semibold">{pane.label}</h2>
          {@render settingRows(pane)}
          <p class="border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">Grenzen und Schritte kommen aus dem Geräteprofil. Jede Änderung wird zurückgelesen.</p>
        </section>
      {/if}
    </div>
  </div>
{:else}
  <div class="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6">
    {@render heading()}
  <!-- One divided surface; the drill-in slides its levels inside it. -->
  <div
    bind:this={box}
    class="glass-ambient relative grid touch-pan-y overflow-hidden rounded-lg border border-border/60 elevation-2"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    role="presentation"
  >
    <!-- Root level. -->
    <section
      class="col-start-1 row-start-1 flex flex-col"
      style:transform="translateX({-30 * p}%)"
      style:opacity={1 - 0.6 * p}
      aria-hidden={p > 0.5}
      inert={p > 0.5}
    >
      <Item.Group class="gap-0 divide-y divide-border/60">
        {#each groups as g (g.id)}
          <Item.Root class="rounded-none border-0">
            {#snippet child({ props })}
              <button {...props} type="button" onclick={() => open(g.id)} class={cn(props.class as string, "group text-left hover:bg-muted/60 active:bg-muted")}>
                <Item.Media class="size-9 rounded-md bg-foreground/[0.06] text-muted-foreground">
                  <g.icon class="size-[18px]" />
                </Item.Media>
                <Item.Content>
                  <Item.Title class="text-[15px]">{g.label}</Item.Title>
                  <Item.Description class="truncate tabular-nums">{summary(g)}</Item.Description>
                </Item.Content>
                <Item.Actions><ChevronRight class="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" /></Item.Actions>
              </button>
            {/snippet}
          </Item.Root>
        {/each}
      </Item.Group>
    </section>
    <!-- Dim over the parent. -->
    <div class="pointer-events-none col-start-1 row-start-1 bg-black" style:opacity={p * 0.28}></div>

    <!-- Child level. -->
    {#if group}
      <section
        class="glass-ambient col-start-1 row-start-1 flex flex-col shadow-[-12px_0_32px_-12px_rgb(0_0_0/0.35)]"
        style:transform="translateX({(1 - p) * 100}%)"
        aria-label={group.label}
      >
        <div class="relative flex items-center border-b border-border/60 p-1.5">
          <Button variant="ghost" size="sm" onclick={() => to(0)} class="text-brand"><ChevronLeft data-icon="inline-start" /> Steuerung</Button>
          <h2 class="absolute left-1/2 -translate-x-1/2 text-[15px] font-semibold">{group.label}</h2>
        </div>
        {@render settingRows(group)}
        <p class="mt-auto px-4 py-3 text-xs text-muted-foreground">Grenzen und Schritte kommen aus dem Geräteprofil. Jede Änderung wird zurückgelesen.</p>
      </section>
    {/if}
  </div>
  </div>
{/if}

<ValueEditor setting={editing} {anchor} bind:open={editorOpen} onapply={apply} below={split} />

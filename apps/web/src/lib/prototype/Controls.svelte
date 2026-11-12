<!--
  PROTOTYPE: drill-in navigation (ADR 21). Tapping a group slides its page in from the right while
  the parent shifts left and dims; ease-in-out ~300 ms, interruptible, edge-swipe back follows the finger.
-->
<script lang="ts">
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import { toast } from "svelte-sonner";
  import { initialGroups, summary, display, type Setting } from "./settings";
  import { tween, spring, VelocityTracker } from "./animate";
  import { haptics } from "./haptics";
  import ValueEditor from "./ValueEditor.svelte";
  import * as Item from "#lib/components/ui/item/index.js";
  import { Badge } from "#lib/components/ui/badge/index.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import { cn } from "#lib/utils.js";

  let { initial = null, initialProgress }: { initial?: string | null; initialProgress?: number } = $props();

  let groups = $state(initialGroups());
  // svelte-ignore state_referenced_locally
  let child = $state<string | null>(initial);
  // svelte-ignore state_referenced_locally
  let p = $state(initialProgress ?? (initial ? 1 : 0));
  let cancel: (() => void) | undefined;
  let box: HTMLDivElement | undefined = $state();

  const group = $derived(groups.find((g) => g.id === child));

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
    if (s.kind === "info") return;
    editing = $state.snapshot(s) as Setting;
    anchor = el;
    editorOpen = true;
    haptics.nudge();
  }

  async function apply(value: number | string): Promise<void> {
    const s = editing!;
    const before = display(s);
    await new Promise((r) => setTimeout(r, 1200));
    for (const g of groups) for (const x of g.settings) if (x.id === s.id) (x as { value: number | string }).value = value;
    const after = display(groups.flatMap((g) => g.settings).find((x) => x.id === s.id)!);
    haptics.success();
    toast.success(`${s.label}: ${after}`, { description: `Bestätigt vom Wechselrichter · vorher ${before}` });
  }

</script>

<div class="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6 lg:py-10">
  <header class="flex items-end justify-between gap-4 px-1">
    <div>
      <p class="text-xs text-muted-foreground">Admin</p>
      <h1 class="text-2xl font-semibold tracking-tight">Steuerung</h1>
    </div>
    <Badge variant="outline" class="text-success"><ShieldCheck /> Schreiben aktiv</Badge>
  </header>

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
                <Item.Media class="size-9 rounded-md" style="background: color-mix(in oklab, {g.tint} 16%, transparent); color: {g.tint}">
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
        <Item.Group class="gap-0 divide-y divide-border/60">
          {#each group.settings as s (s.id)}
            {#if s.kind === "info"}
              <Item.Root class="rounded-none border-0">
                <Item.Content><Item.Title class="text-[15px] font-normal">{s.label}</Item.Title></Item.Content>
                <Item.Actions class="text-sm text-muted-foreground">{s.value}</Item.Actions>
              </Item.Root>
            {:else}
              <Item.Root class="rounded-none border-0">
                {#snippet child({ props })}
                  <button
                    {...props}
                    type="button"
                    data-setting={s.id}
                    onclick={(e) => edit(s, e.currentTarget)}
                    aria-haspopup="dialog"
                    class={cn(props.class as string, "text-left hover:bg-muted/60 active:bg-muted", editorOpen && editing?.id === s.id && "bg-muted")}
                  >
                    <Item.Content><Item.Title class="text-[15px] font-normal">{s.label}</Item.Title></Item.Content>
                    <Item.Actions>
                      <Badge variant="secondary" class="h-6 px-2 text-sm tabular-nums">{display(s)}</Badge>
                      <ChevronRight class="size-4 text-muted-foreground" />
                    </Item.Actions>
                  </button>
                {/snippet}
              </Item.Root>
            {/if}
          {/each}
        </Item.Group>
        <p class="mt-auto px-4 py-3 text-xs text-muted-foreground">Grenzen und Schritte kommen aus dem Geräteprofil. Jede Änderung wird zurückgelesen.</p>
      </section>
    {/if}
  </div>
</div>

<ValueEditor setting={editing} {anchor} bind:open={editorOpen} onapply={apply} />

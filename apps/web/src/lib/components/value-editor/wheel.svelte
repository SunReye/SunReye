<!--
  Momentum drum (ADR 21). A fling coasts and lands on a step, a slow release springs to the
  nearest one. Off-centre rows shrink and fade. Rendering runs only while it moves.
-->
<script lang="ts">
  import { spring, VelocityTracker } from "../../animate.ts";
  import { haptics } from "../../haptics.ts";
  import { motion } from "../../motion/tier.svelte.ts";
  import { m } from "../../paraglide/messages.js";
  import type { Rows } from "./editable.ts";

  let {
    rows,
    index = $bindable(0),
    current,
    format,
    unit = "",
    ariaLabel,
    onlive,
    marker = "label",
    class: className = "",
  }: {
    rows: Rows;
    index?: number;
    /** The row of the device's value: it keeps a faint marker. */
    current?: number | undefined;
    format: (value: number) => string;
    unit?: string;
    ariaLabel: string;
    /** The fractional row while it moves, for the rolling digits. */
    onlive?: (pos: number) => void;
    /** How the device's row is marked: "now" beside it, or a dot where two wheels sit side by side. */
    marker?: "label" | "dot";
    class?: string;
  } = $props();

  const count = $derived(rows.count);
  const label = (i: number) => format(rows.at(i));
  const ROW = 44;
  const ROWS = 5;

  // svelte-ignore state_referenced_locally
  let pos = $state(index);

  // svelte-ignore state_referenced_locally
  let committed = index;
  let cancel: (() => void) | undefined;
  let dragging = $state(false);
  let target: number | undefined;

  const clamp = (i: number) => Math.max(0, Math.min(count - 1, i));

  function setPos(p: number): void {
    pos = p;
    onlive?.(p);
    const r = clamp(Math.round(p));

    if (r !== committed) {
      committed = r;
      index = r;
      haptics.selection();
    }
  }

  function stop(): void {
    cancel?.();
    cancel = undefined;
  }

  function springTo(i: number, velocity = 0): void {
    stop();
    target = clamp(i);
    cancel = spring(
      pos,
      target,
      (x) => setPos(x),
      { stiffness: 320, damping: 30, velocity, precision: 0.002 },
      () => {
        target = undefined;
        cancel = undefined;
      },
    );
  }

  /** Coast with exponential decay onto `to`: velocity at release ≈ (to - pos) / τ. */
  function coastTo(to: number): void {
    stop();
    const end = clamp(to);
    target = end;

    if (motion.still) {
      setPos(end);
      target = undefined;

      return;
    }

    const from = pos;
    const tau = 325;
    const t0 = performance.now();

    let raf = requestAnimationFrame(function frame(now) {
      const x = end - (end - from) * Math.exp(-(now - t0) / tau);

      if (Math.abs(end - x) < 0.003) {
        setPos(end);
        target = undefined;
        cancel = undefined;

        return;
      }

      setPos(x);
      raf = requestAnimationFrame(frame);
    });

    cancel = () => cancelAnimationFrame(raf);
  }

  // An outside change (a typed value): move there.
  $effect(() => {
    const i = index;

    if (!dragging && cancel === undefined && i !== Math.round(pos)) springTo(i);
  });

  const tracker = new VelocityTracker();
  let startY = 0;
  let startPos = 0;
  let moved = false;
  let el: HTMLDivElement | undefined = $state();

  function rubber(p: number): number {
    const max = count - 1;

    if (p < 0) return -(1 - 1 / (1 + -p * 0.35)) / 0.35;

    if (p > max) return max + (1 - 1 / (1 + (p - max) * 0.35)) / 0.35;

    return p;
  }

  function down(e: PointerEvent): void {
    if (e.button !== 0) return;

    stop();
    dragging = true;
    moved = false;
    startY = e.clientY;
    startPos = pos;
    tracker.reset();
    tracker.push(pos);
    el?.setPointerCapture(e.pointerId);
  }

  function move(e: PointerEvent): void {
    if (!dragging) return;

    const dy = e.clientY - startY;

    if (Math.abs(dy) > 4) moved = true;

    const raw = startPos - dy / ROW;
    tracker.push(raw);
    setPos(rubber(raw));
  }

  function up(e: PointerEvent): void {
    if (!dragging || el === undefined) return;

    dragging = false;

    if (!moved) {
      // A tap on a row goes there.
      const rect = el.getBoundingClientRect();
      const d = Math.round((e.clientY - (rect.top + rect.height / 2)) / ROW);
      springTo(Math.round(pos) + d);

      return;
    }

    // Fling speed scales with the range.
    const boost = Math.max(1, Math.min(3, count / 60));
    const v = tracker.velocity() * boost;

    if (Math.abs(v) < 3 || pos < 0 || pos > count - 1) springTo(Math.round(pos), v);
    else coastTo(Math.round(pos + v * 0.325));
  }

  // A mouse wheel moves one step per notch; a trackpad accumulates.
  let accum = 0;

  function wheel(e: WheelEvent): void {
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
    let steps = 0;

    if (e.deltaMode !== 0 || Math.abs(dy) >= 50) steps = Math.sign(dy);
    else {
      accum += dy;

      if (Math.abs(accum) >= 28) {
        steps = Math.sign(accum);
        accum = 0;
      }
    }

    if (steps !== 0) springTo((target ?? Math.round(pos)) + steps);
  }

  // Up raises the value, as a spinbutton does.
  const KEYS = new Map([
    ["ArrowUp", 1],
    ["ArrowRight", 1],
    ["ArrowDown", -1],
    ["ArrowLeft", -1],
    ["PageUp", 10],
    ["PageDown", -10],
  ]);

  function key(e: KeyboardEvent): void {
    const base = target ?? Math.round(pos);
    const by = KEYS.get(e.key);

    if (by !== undefined) springTo(base + by);
    else if (e.key === "Home") springTo(0);
    else if (e.key === "End") springTo(count - 1);
    else return;

    e.preventDefault();
  }

  function attachWheel(node: HTMLElement) {
    node.addEventListener("wheel", wheel, { passive: false });

    return () => node.removeEventListener("wheel", wheel);
  }

  const visible = $derived.by(() => {
    const out: number[] = [];
    const reach = Math.ceil(ROWS / 2) + 1;

    for (let i = Math.floor(pos) - reach; i <= Math.ceil(pos) + reach; i++)
      if (i >= 0 && i < count) out.push(i);

    return out;
  });
</script>

<div
  bind:this={el}
  {@attach attachWheel}
  class={["relative touch-none outline-none select-none", className]}
  style:height="{ROWS * ROW}px"
  role="spinbutton"
  tabindex="0"
  aria-label={ariaLabel}
  aria-valuemin={rows.at(0)}
  aria-valuemax={rows.at(count - 1)}
  aria-valuenow={rows.at(index)}
  aria-valuetext={label(index) + (unit ? ` ${unit}` : "")}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  onkeydown={key}
>
  <!-- Centre band. -->
  <div
    class="pointer-events-none absolute inset-x-1 rounded-md bg-muted/70 ring-1 ring-border/60 ring-inset"
    style:top="calc(50% - {ROW / 2}px)"
    style:height="{ROW}px"
  ></div>
  {#each visible as i (i)}
    {@const d = i - pos}
    {@const ad = Math.abs(d)}
    <div
      class="pointer-events-none absolute inset-x-0 flex items-center justify-center text-xl font-medium tabular-nums"
      style:top="calc(50% - {ROW / 2}px)"
      style:height="{ROW}px"
      style:transform="translateY({d * ROW}px) perspective(400px) rotateX({-d * 16}deg) scale({1 -
        Math.min(0.4, ad * 0.12)})"
      style:opacity={Math.max(0, 1 - ad * 0.34)}
    >
      <span class={[ad < 0.5 ? "text-foreground" : "text-muted-foreground"]}>{label(i)}</span>
      {#if i === current && marker === "dot"}
        <span
          class="absolute left-2 size-1 rounded-full bg-muted-foreground/70"
          title={m.editor_now()}
        ></span>
      {:else if i === current}
        <span class="absolute right-3 flex items-center gap-1 text-xs text-muted-foreground">
          <span class="size-1 rounded-full bg-muted-foreground/70"></span>{m.editor_now()}
        </span>
      {/if}
    </div>
  {/each}
  {#if unit}
    <span
      class="pointer-events-none absolute left-[calc(50%+2.4rem)] text-sm text-muted-foreground"
      style:top="calc(50% - 0.6em)">{unit}</span
    >
  {/if}
  <!-- Fade top and bottom. -->
  <div
    class="pointer-events-none absolute inset-0 [mask-image:linear-gradient(#000,transparent_30%,transparent_70%,#000)]"
  ></div>
</div>

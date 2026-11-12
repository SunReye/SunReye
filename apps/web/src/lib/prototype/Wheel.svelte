<!--
  PROTOTYPE: momentum drum (ADR 21 value editor). A fling coasts and lands on a step, a slow
  release springs to the nearest one. Off-centre rows shrink and fade. Rendering runs only
  while it moves.
-->
<script lang="ts">
  import { haptics } from "./haptics";
  import { spring, VelocityTracker, reducedMotion } from "./animate";

  let {
    count,
    index = $bindable(0),
    current,
    label,
    valueText,
    unit = "",
    ariaLabel,
    onlive,
    rowH = 44,
    rows = 5,
    marker = "label",
    class: className = "",
  }: {
    count: number;
    index?: number;
    current?: number;
    label: (i: number) => string;
    valueText?: (i: number) => string;
    unit?: string;
    ariaLabel: string;
    onlive?: (pos: number) => void;
    rowH?: number;
    rows?: number;
    marker?: "label" | "dot";
    class?: string;
  } = $props();

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
    cancel = spring(pos, target, (x) => setPos(x), { stiffness: 320, damping: 30, velocity, precision: 0.002 }, () => {
      target = undefined;
      cancel = undefined;
    });
  }

  /** Coast with exponential decay onto `to`: velocity at release ≈ (to - pos) / τ. */
  function coastTo(to: number): void {
    stop();
    target = clamp(to);
    if (reducedMotion()) {
      setPos(target);
      return;
    }
    const from = pos;
    const tau = 325;
    const t0 = performance.now();
    let raf = requestAnimationFrame(function frame(now) {
      const e = Math.exp(-(now - t0) / tau);
      const x = target! - (target! - from) * e;
      if (Math.abs(target! - x) < 0.003) {
        setPos(target!);
        target = undefined;
        cancel = undefined;
        return;
      }
      setPos(x);
      raf = requestAnimationFrame(frame);
    });
    cancel = () => cancelAnimationFrame(raf);
  }

  // External change (typed value, key on another control): move there.
  $effect(() => {
    const i = index;
    if (!dragging && cancel === undefined && i !== Math.round(pos)) springTo(i);
  });

  // Pointer drag.
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
    const raw = startPos - dy / rowH;
    tracker.push(raw);
    setPos(rubber(raw));
  }

  function up(e: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    if (!moved) {
      // Tap on a row: go there.
      const rect = el!.getBoundingClientRect();
      const d = Math.round((e.clientY - (rect.top + rect.height / 2)) / rowH);
      springTo(Math.round(pos) + d);
      return;
    }
    // Fling speed scales with the range.
    const boost = Math.max(1, Math.min(3, count / 60));
    const v = tracker.velocity() * boost;
    if (Math.abs(v) < 3 || pos < 0 || pos > count - 1) springTo(Math.round(pos), v);
    else coastTo(Math.round(pos + v * 0.325));
  }

  // Mouse wheel: one notch per step; trackpads accumulate.
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
    if (steps) springTo((target ?? Math.round(pos)) + steps);
  }

  function key(e: KeyboardEvent): void {
    const base = target ?? Math.round(pos);
    // Up raises the value, as a spinbutton does.
    const map: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 };
    if (e.key in map) {
      e.preventDefault();
      springTo(base + map[e.key]!);
    } else if (e.key === "Home") {
      e.preventDefault();
      springTo(0);
    } else if (e.key === "End") {
      e.preventDefault();
      springTo(count - 1);
    }
  }

  function attachWheel(node: HTMLElement) {
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }

  const visible = $derived.by(() => {
    const out: number[] = [];
    const reach = Math.ceil(rows / 2) + 1;
    for (let i = Math.floor(pos) - reach; i <= Math.ceil(pos) + reach; i++) if (i >= 0 && i < count) out.push(i);
    return out;
  });
</script>

<div
  bind:this={el}
  {@attach attachWheel}
  class="wheel relative touch-none select-none outline-none {className}"
  style:height="{rows * rowH}px"
  role="spinbutton"
  tabindex="0"
  aria-label={ariaLabel}
  aria-valuemin={0}
  aria-valuemax={count - 1}
  aria-valuenow={index}
  aria-valuetext={(valueText ?? label)(index) + (unit ? ` ${unit}` : "")}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  onkeydown={key}
>
  <!-- Centre band. -->
  <div
    class="pointer-events-none absolute inset-x-1 rounded-md bg-muted/70 ring-1 ring-border/60 ring-inset"
    style:top="calc(50% - {rowH / 2}px)"
    style:height="{rowH}px"
  ></div>
  {#each visible as i (i)}
    {@const d = i - pos}
    {@const ad = Math.abs(d)}
    <div
      class="pointer-events-none absolute inset-x-0 flex items-center justify-center text-xl font-medium tabular-nums"
      style:top="calc(50% - {rowH / 2}px)"
      style:height="{rowH}px"
      style:transform="translateY({d * rowH}px) perspective(400px) rotateX({-d * 16}deg) scale({1 - Math.min(0.4, ad * 0.12)})"
      style:opacity={Math.max(0, 1 - ad * 0.34)}
    >
      <span class={[ad < 0.5 ? "text-foreground" : "text-muted-foreground"]}>{label(i)}</span>
      {#if i === current && marker === "dot"}
        <span class="absolute left-2 size-1 rounded-full bg-muted-foreground/70" title="jetzt"></span>
      {:else if i === current}
        <span class="absolute right-3 flex items-center gap-1 text-[10px] font-medium tracking-wide text-muted-foreground/80 uppercase">
          <span class="size-1 rounded-full bg-muted-foreground/70"></span>jetzt
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
  <div class="pointer-events-none absolute inset-0 [mask-image:linear-gradient(#000,transparent_30%,transparent_70%,#000)]"></div>
</div>

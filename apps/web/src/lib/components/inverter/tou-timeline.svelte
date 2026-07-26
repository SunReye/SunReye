<script lang="ts">
	import TouSlotPanel from './_shared/tou-slot-panel.svelte';
	import TouClockChrome from './_shared/tou-clock-chrome.svelte';
	import TouPeriodBlock from './_shared/tou-period-block.svelte';
	import TouSlotChip from './_shared/tou-slot-chip.svelte';
	import TouHourAxis from './_shared/tou-hour-axis.svelte';
	import * as msg from '$lib/paraglide/messages';
	import {
		hhmmToMinutes,
		hhmmToLabel,
		minutesToLabel,
		type TouController,
		type TouSlot
	} from '$lib/inverter/tou.svelte';

	let { controller }: { controller: TouController } = $props();

	const MIN_PER_DAY = 24 * 60;
	const HOUR_TICKS = [0, 6, 12, 18, 24];

	const slots = $derived(controller.slots);
	// Battery mode decides the per-slot target: voltage (lead-acid) or SOC (lithium).
	const mode = $derived(controller.targetMode);

	// Live "now" marker so the user can see which period is active right now.
	let nowMin = $state(currentMinutes());
	function currentMinutes(): number {
		const d = new Date();
		return d.getHours() * 60 + d.getMinutes();
	}
	$effect(() => {
		const id = setInterval(() => (nowMin = currentMinutes()), 30_000);
		return () => clearInterval(id);
	});

	function fieldVal(slot: TouSlot, field: 'time' | 'power' | 'voltage' | 'soc' | 'enabled') {
		const m = slot.metrics[field];
		return m ? controller.value(m.key) : undefined;
	}

	type Start = { slot: TouSlot; startMin: number };
	type Piece = { slot: TouSlot; startMin: number; lenMin: number; leftPct: number; widthPct: number };

	const pct = (min: number) => (min / MIN_PER_DAY) * 100;

	/** Each slot's start minute, or null while its register is still unread. */
	function slotStarts() {
		return slots.map((slot) => {
			const v = fieldVal(slot, 'time');
			return { slot, startMin: v === undefined ? null : hhmmToMinutes(v) };
		});
	}

	/** Equal-width index blocks, for when a clock axis would be meaningless. */
	function equalWidthPieces(): Piece[] {
		const w = slots.length ? 100 / slots.length : 100;
		return slots.map((slot, i) => ({
			slot,
			startMin: 0,
			lenMin: 0,
			leftPct: i * w,
			widthPct: w
		}));
	}

	/** Append one period, split into two pieces when it crosses midnight. */
	function pushPeriod(pieces: Piece[], slot: TouSlot, startMin: number, lenMin: number) {
		const end = startMin + lenMin;
		if (end <= MIN_PER_DAY) {
			pieces.push({ slot, startMin, lenMin, leftPct: pct(startMin), widthPct: pct(lenMin) });
			return;
		}
		const beforeMidnight = MIN_PER_DAY - startMin;
		const afterMidnight = end - MIN_PER_DAY;
		pieces.push({
			slot,
			startMin,
			lenMin: beforeMidnight,
			leftPct: pct(startMin),
			widthPct: pct(beforeMidnight)
		});
		pieces.push({
			slot,
			startMin: 0,
			lenMin: afterMidnight,
			leftPct: 0,
			widthPct: pct(afterMidnight)
		});
	}

	/**
	 * One block per period, running from its start until the *next start in clock
	 * order* (not slot-index order), so the blocks always tile the day without
	 * overlap even when the times aren't in ascending index order.
	 */
	function clockPieces(sorted: Start[]): Piece[] {
		const pieces: Piece[] = [];
		for (let i = 0; i < sorted.length; i++) {
			const cur = sorted[i].startMin;
			// The last block wraps to the first start of the next day.
			const next =
				i + 1 < sorted.length ? sorted[i + 1].startMin : sorted[0].startMin + MIN_PER_DAY;
			const lenMin = next - cur;
			// A duplicate start is a zero-length period — nothing to draw.
			if (lenMin <= 0) continue;
			pushPeriod(pieces, sorted[i].slot, cur, lenMin);
		}
		return pieces;
	}

	// Lay the six slots out on a real 00:00→24:00 axis when every start is known and
	// they aren't all identical; otherwise fall back to equal-width index blocks.
	const layout = $derived.by(() => {
		const known = slotStarts().filter((e): e is Start => e.startMin !== null);
		const realAxis =
			known.length === slots.length && new Set(known.map((e) => e.startMin)).size > 1;
		if (!realAxis) return { realAxis, pieces: equalWidthPieces() };
		// Clock order, ties broken by slot index for stability.
		const sorted = [...known].sort((a, b) => a.startMin - b.startMin || a.slot.index - b.slot.index);
		return { realAxis, pieces: clockPieces(sorted) };
	});

	/** Fallback selection when no period covers "now". */
	const firstIndex = $derived(slots[0]?.index ?? null);
	const covers = (p: Piece, min: number) => min >= p.startMin && min < p.startMin + p.lenMin;

	// The slot whose period contains "now", used as the default selection.
	const activeIndex = $derived.by(() => {
		if (!layout.realAxis) return firstIndex;
		return layout.pieces.find((p) => covers(p, nowMin))?.slot.index ?? firstIndex;
	});

	let selectedIndex = $state<number | null>(null);
	const selected = $derived(
		slots.find((s) => s.index === selectedIndex) ??
			slots.find((s) => s.index === activeIndex) ??
			slots[0] ??
			null
	);

	// The inverter stores only a start time per slot; a period ends where the
	// next slot begins (the manual shows this derived end as a second column).

	/** `[start, end]` hhmm of a slot's period, or null while either is unread. */
	function periodBounds(slot: TouSlot): [number, number] | null {
		const pos = slots.findIndex((s) => s.index === slot.index);
		const start = fieldVal(slot, 'time');
		const end = fieldVal(slots[(pos + 1) % slots.length], 'time');
		return start === undefined || end === undefined ? null : [start, end];
	}

	const selectedRange = $derived.by(() => {
		if (!selected || slots.length < 2) return null;
		const bounds = periodBounds(selected);
		return bounds ? `${hhmmToLabel(bounds[0])} → ${hhmmToLabel(bounds[1])}` : null;
	});

	// Grid-charge periods are amber, discharge periods sky.
	const blockClassOf = (grid: boolean) =>
		grid
			? 'border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20'
			: 'border-sky-500/40 bg-sky-500/10 hover:bg-sky-500/20';
	const fillClassOf = (grid: boolean) => (grid ? 'bg-amber-500/25' : 'bg-sky-500/25');

	/**
	 * Bar height as a percentage. Voltage targets have no natural 0–100 range, so
	 * they normalize across the slots' own min–max span (a single distinct value
	 * sits mid-height); SOC maps straight to a percentage.
	 */
	function fillHeightOf(target: number, useVoltage: boolean, min: number, span: number) {
		if (!useVoltage) return Math.max(0, Math.min(100, target));
		return span > 0 ? ((target - min) / span) * 100 : 50;
	}

	/** Block caption: the period's clock start, or its slot number off-axis. */
	const labelOf = (p: Piece) =>
		layout.realAxis ? minutesToLabel(p.startMin) : msg.tou_slot_n({ index: p.slot.index });

	/** Hover title: slot number, clock range on a real axis, target, grid flag. */
	function titleOf(p: Piece, target: number, unit: string, grid: boolean, useVoltage: boolean) {
		const range = layout.realAxis
			? ` · ${minutesToLabel(p.startMin)}–${minutesToLabel(p.startMin + p.lenMin)}`
			: '';
		const kind = useVoltage ? msg.tou_target_label() : 'SOC';
		const gridNote = grid ? ` · ${msg.tou_grid_charge_lower()}` : '';
		return `${msg.tou_slot_n({ index: p.slot.index })}${range} · ${kind} ${target}${unit}${gridNote}`;
	}

	// Precompute everything the timeline blocks and picker chips render, so the
	// markup below stays branch-free (keeps the template's complexity in budget).
	const renderPieces = $derived.by(() => {
		const useVoltage = mode === 'voltage';
		const targetOf = (p: Piece) =>
			(useVoltage ? fieldVal(p.slot, 'voltage') : fieldVal(p.slot, 'soc')) ?? 0;
		const vals = layout.pieces.map(targetOf);
		const min = Math.min(...vals);
		const span = Math.max(...vals) - min;
		const unit = useVoltage ? 'V' : '%';
		return layout.pieces.map((p) => {
			const target = targetOf(p);
			const grid = fieldVal(p.slot, 'enabled') === 1;
			return {
				...p,
				target,
				unit,
				grid,
				fillHeight: fillHeightOf(target, useVoltage, min, span),
				blockClass: blockClassOf(grid),
				fillClass: fillClassOf(grid),
				label: labelOf(p),
				showLabel: p.widthPct > 10,
				showTarget: p.widthPct > 7,
				title: titleOf(p, target, unit, grid, useVoltage)
			};
		});
	});

	/** Index of the selected slot, for the block/chip highlight. */
	const selectedIdx = $derived(selected?.index ?? null);
	const barHeightNote = $derived(
		mode === 'voltage' ? msg.tou_bar_height_voltage() : msg.tou_bar_height_soc()
	);
	const select = (index: number) => () => (selectedIndex = index);

	const chips = $derived(
		slots.map((s) => ({
			slot: s,
			grid: fieldVal(s, 'enabled') === 1,
			time: hhmmToLabel(fieldVal(s, 'time'))
		}))
	);
</script>

<div class="flex flex-col gap-5">
	<!-- 24-hour timeline -->
	<div class="flex flex-col gap-1.5">
		<div class="relative h-24 w-full">
			<TouClockChrome
				show={layout.realAxis}
				hourTicks={HOUR_TICKS}
				{nowMin}
				minutesPerDay={MIN_PER_DAY}
			/>

			{#each renderPieces as piece, i (i)}
				<TouPeriodBlock
					{piece}
					selected={selectedIdx === piece.slot.index}
					onSelect={select(piece.slot.index)}
				/>
			{/each}
		</div>

		<TouHourAxis show={layout.realAxis} hourTicks={HOUR_TICKS} />

		<!-- legend -->
		<div class="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground">
			<span class="flex items-center gap-1.5">
				<span class="size-2.5 rounded-sm border border-amber-500/40 bg-amber-500/25"></span>
				{msg.tou_legend_grid_charge()}
			</span>
			<span class="flex items-center gap-1.5">
				<span class="size-2.5 rounded-sm border border-sky-500/40 bg-sky-500/25"></span>
				{msg.tou_legend_discharge()}
			</span>
			<span class="flex items-center gap-1.5">
				<span class="h-2.5 w-0.5 bg-foreground/70"></span>
				{msg.tou_now()}
			</span>
			<span>{barHeightNote}</span>
		</div>
	</div>

	<!-- Slot picker: every slot stays reachable even when its block is thin or
		 collapsed (duplicate start times), which the timeline can't guarantee. -->
	<div class="flex flex-wrap gap-1.5">
		{#each chips as chip (chip.slot.index)}
			<TouSlotChip
				index={chip.slot.index}
				time={chip.time}
				grid={chip.grid}
				selected={selectedIdx === chip.slot.index}
				active={activeIndex === chip.slot.index}
				onSelect={select(chip.slot.index)}
			/>
		{/each}
	</div>

	<TouSlotPanel {controller} slot={selected} range={selectedRange} slotCount={slots.length} />
</div>

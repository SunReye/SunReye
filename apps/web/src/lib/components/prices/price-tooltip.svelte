<script lang="ts">
	import { getChartContext, Tooltip as TooltipPrimitive } from 'layerchart';
	import type { PriceRow } from '$lib/prices/price-series';
	import { formatNumber } from '$lib/format/number';
	import * as m from '$lib/paraglide/messages';

	// The diverging halves would each report their own value through
	// Chart.Tooltip's formatter, which for a price is nonsense — one of them is
	// always 0. So read the whole hovered row from the layerchart context and
	// show the single real figure instead.
	const ctx = getChartContext();
	const row = $derived(ctx.tooltip.data as PriceRow | null);

	const ct = (v: number) =>
		`${formatNumber(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ct/kWh`;
</script>

<TooltipPrimitive.Root variant="none">
	{#if row}
		<div
			class="grid min-w-[11rem] items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl"
		>
			<div class="font-medium tabular-nums">{row.label}</div>
			<div class="flex items-center justify-between gap-4 leading-none">
				<span class="text-muted-foreground">{m.prices_series_price()}</span>
				<span class="font-mono font-medium tabular-nums text-foreground">{ct(row.ctPerKwh)}</span>
			</div>
			{#if row.negative}
				<div class="border-t border-border/50 pt-1.5 leading-none text-muted-foreground">
					{m.prices_tooltip_no_payment()}
				</div>
			{/if}
		</div>
	{/if}
</TooltipPrimitive.Root>

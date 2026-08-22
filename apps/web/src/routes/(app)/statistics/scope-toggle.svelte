<script lang="ts">
	// A chart panel's one window control.
	//
	// It replaces a two-chip segmented switcher that read "By day | 12 months":
	// a BUCKET name beside a SPAN name, two grammars in one row, with nothing to
	// say which of the two was showing. The bucket was never a choice anyway —
	// every calendar grain has exactly one granularity inside it
	// (`PERIOD_DETAIL_BUCKET` in `$lib/cost/ranges`), and the caption under the
	// panel title already says which one is drawn.
	//
	// So this is one button, and it always names the window the reader is NOT
	// looking at: "12 months" while the picked month is plotted, "Aug 2026" while
	// the trailing twelve are. Pressing it therefore has one obvious outcome, and
	// the way back is named after the period the navigator above it names.
	import { Button } from '$lib/components/ui/button';
	import * as m from '$lib/paraglide/messages';
	import { scopeToggle } from '$lib/statistics/chart-scope';
	import type { SectionScope } from '$lib/statistics/chart-scope.svelte';
	import type { CostRange } from '$lib/cost/ranges';

	let { view, range }: { view: SectionScope; range: CostRange } = $props();

	const toggle = $derived(scopeToggle(range, view.scope));
</script>

<!-- The visible label is the window's name; the accessible name says what
     pressing it does, and contains that label (WCAG 2.5.3). `size="default"`
     rather than the switcher's `sm`, because a lone button has no bordered row
     around it to make up the thumb's difference. -->
<Button
	variant="outline"
	aria-label={m.statistics_scope_show({ window: toggle.label })}
	onclick={() => (view.scope = toggle.next)}
>
	{toggle.label}
</Button>

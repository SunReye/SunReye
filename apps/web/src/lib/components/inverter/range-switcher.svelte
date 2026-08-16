<script lang="ts" generics="T extends string">
	import { Button } from '$lib/components/ui/button';
	import OptionSelect from '$lib/components/settings/option-select.svelte';
	import { needsCompactSwitcher } from '$lib/layout/tokens';

	// Segmented button group for picking a named range (history window, cost
	// period, …). Generic over the option id so `bind:value` stays type-safe.
	let {
		options,
		value = $bindable()
	}: {
		options: readonly { id: T; label: string }[];
		value: T;
	} = $props();

	// Past three options the row wraps at 412px, and the wrapped remainder reads
	// as a second, unrelated control rather than as more of the same choice. Those
	// switchers get a Select on a phone and the row back from sm up.
	//
	// Both forms are rendered and CSS chooses: a media query in JS would mean a
	// resize listener per switcher and a control that visibly swaps on rotate.
	// Only the switchers that need it pay for the second one.
	const compact = $derived(needsCompactSwitcher(options.length));
	const items = $derived(options.map((o) => ({ value: o.id, label: o.label })));

	// Both decisions live here rather than as ternaries in the markup: a template
	// is the one place this repo cannot unit-test, so it holds no branches it does
	// not have to.
	const rowClass = $derived(
		`${compact ? 'hidden sm:flex' : 'flex'} flex-wrap items-center gap-1 border border-border p-1`
	);
	const variantFor = (id: T) => (value === id ? ('default' as const) : ('ghost' as const));
</script>

{#if compact}
	<OptionSelect {items} {value} onchange={(v) => (value = v as T)} triggerClass="sm:hidden" />
{/if}
<div class={rowClass}>
	{#each options as o (o.id)}
		<Button variant={variantFor(o.id)} size="sm" onclick={() => (value = o.id)}>
			{o.label}
		</Button>
	{/each}
</div>

<script lang="ts" generics="T extends string">
	import * as ButtonGroup from '$lib/components/ui/button-group';
	import { NativeSelect } from '$lib/components/ui/native-select';
	import * as ToggleGroup from '$lib/components/ui/toggle-group';
	import { needsCompactSwitcher, TOOLBAR_CONTROL_H } from '$lib/layout/tokens';
	import * as m from '$lib/paraglide/messages';
	import { commitRangeSelection } from './range-switcher';

	// Segmented button group for picking a named range (history window, cost
	// period, …). Generic over the option id so `bind:value` stays type-safe.
	//
	// The row is a real ToggleGroup, not a row of Buttons whose variant flips: a
	// bare row has no group semantics, so a keyboard user tabbed through four
	// unrelated controls and a screen reader was never told they are one choice.
	let {
		options,
		value = $bindable(),
		label
	}: {
		options: readonly { id: T; label: string }[];
		value: T;
		/**
		 * What this switcher selects, for the radiogroup's accessible name.
		 *
		 * Required, and per-caller rather than one shared string: the six
		 * switchers on this app pick six different things, and the period
		 * navigator's arrow row already answers to "Select range". Two controls
		 * with one accessible name is precisely the defect
		 * `e2e/statistics-control-names.spec.ts` exists to catch — it caught this
		 * one, when the row first became a real group and inherited that string.
		 */
		label: string;
	} = $props();

	// Past three options the row wraps at 412px, and the wrapped remainder reads
	// as a second, unrelated control rather than as more of the same choice. Those
	// switchers get a select on a phone and the row back from sm up.
	//
	// Both forms are rendered and CSS chooses: a media query in JS would mean a
	// resize listener per switcher and a control that visibly swaps on rotate.
	// Only the switchers that need it pay for the second one.
	//
	// The phone form is the OS picker rather than a styled Select, because the
	// native list cannot overflow a 360px card in any locale — the length-proof
	// floor under the whole control grammar.
	const compact = $derived(needsCompactSwitcher(options.length));

	// Both decisions live here rather than as ternaries in the markup: a template
	// is the one place this repo cannot unit-test, so it holds no branches it does
	// not have to. TOOLBAR_CONTROL_H keeps the row the height of its toolbar
	// peers — the navigator and the icon buttons are a row of equals.
	const rowClass = $derived(
		`${compact ? 'hidden sm:flex' : 'flex'} ${TOOLBAR_CONTROL_H} items-stretch`
	);
</script>

{#if compact}
	<NativeSelect
		bind:value={() => value, (v) => (value = commitRangeSelection(v, value))}
		size="sm"
		class="sm:hidden"
		aria-label={label}
	>
		{#each options as o (o.id)}
			<option value={o.id}>{o.label}</option>
		{/each}
	</NativeSelect>
{/if}
<ButtonGroup.Root class={rowClass}>
	<!-- The name goes on the radiogroup, not on the ButtonGroup wrapping it: the
	     wrapper is presentational (it draws the shared border), and naming it too
	     would put a second, identically-named `group` on the page per switcher. -->
	<ToggleGroup.Root
		aria-label={label}
		type="single"
		variant="outline"
		size="sm"
		class="h-full"
		bind:value={() => value, (v) => (value = commitRangeSelection(v, value))}
	>
		{#each options as o (o.id)}
			<ToggleGroup.Item value={o.id} class="h-full">{o.label}</ToggleGroup.Item>
		{/each}
	</ToggleGroup.Root>
</ButtonGroup.Root>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import Section from '$lib/components/layout/section.svelte';
	import PlusIcon from 'phosphor-svelte/lib/Plus';

	// The "add a row" form shared by the users and API-key panels: a settings
	// section wrapping a responsive grid of fields plus the submit button.
	let {
		title,
		gridClass,
		submitLabel,
		busy,
		onsubmit,
		children
	}: {
		title: string;
		/** Column template for the field grid — the field count differs per form. */
		gridClass: string;
		submitLabel: string;
		busy: boolean;
		onsubmit: (e: SubmitEvent) => void;
		children: Snippet;
	} = $props();
</script>

<Section {title}>
	<form class="grid grid-cols-1 items-end gap-3 {gridClass}" {onsubmit}>
		{@render children()}
		<Button type="submit" disabled={busy}>
			<PlusIcon class="size-4" />
			{submitLabel}
		</Button>
	</form>
</Section>

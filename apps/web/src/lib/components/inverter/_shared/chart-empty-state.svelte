<script lang="ts">
	// Placeholder for the custom-chart section when nothing has been saved yet.
	// Admins get a shortcut to create the first chart.
	import ChartLine from 'phosphor-svelte/lib/ChartLine';
	import { Button } from '$lib/components/ui/button';
	import * as m from '$lib/paraglide/messages';

	let { isAdmin, onCreate }: { isAdmin: boolean; onCreate: () => void } = $props();
</script>

<div
	class="flex h-40 flex-col items-center justify-center gap-2 border border-dashed border-border text-sm text-muted-foreground"
>
	<ChartLine class="size-6" />
	<span>{m.chart_none_yet()}</span>
	{#if isAdmin}
		<Button size="sm" variant="ghost" onclick={onCreate}>{m.chart_create_first()}</Button>
	{/if}
</div>

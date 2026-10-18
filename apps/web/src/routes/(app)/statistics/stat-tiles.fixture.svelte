<script lang="ts">
	// Test-only host for `stat-tiles.svelte`: the grid reads the page's customize
	// session from context, so this puts one there. Mounted by
	// `stat-tiles.svelte.test.ts`.
	import { setCustomizeSession } from '$lib/statistics/customize.svelte';
	import type { TileDef } from '$lib/statistics/tiles';
	import { costFormatters } from '$lib/cost/format';
	import StatTiles from './stat-tiles.svelte';
	import PageShell from '$lib/components/layout/page-shell.svelte';
	import Section from '$lib/components/layout/section.svelte';

	let { defs }: { defs: readonly TileDef<null>[] } = $props();

	setCustomizeSession();
</script>

<!-- Inside the shell and section it ships in: the tile frame bleeds into the
     section's padding on a phone, so its edges only mean anything there. -->
<PageShell width="wide">
	<Section title="Energy">
		<StatTiles {defs} data={null} formatters={costFormatters('EUR')} />
	</Section>
</PageShell>

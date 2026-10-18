<script lang="ts">
	// Test-only host for `chart-fullscreen.svelte`, standing in for the dialog it
	// ships in: a small box centred with a transform (which makes `fixed`
	// resolve against the box, not the viewport) that takes pointer input back
	// from a scroll-locked body, as `Dialog.Content` does. Mounted by
	// `chart-fullscreen.svelte.test.ts`.
	import ChartFullscreen from './chart-fullscreen.svelte';
	import { CHART_BOX } from '$lib/layout/tokens';
</script>

<div data-testid="dialog" class="pointer-events-auto w-80 translate-x-4">
	<ChartFullscreen title="Forecast">
		<div>
			<div data-slot="chart" data-testid="plot" class="{CHART_BOX} w-full"></div>
		</div>
	</ChartFullscreen>
</div>

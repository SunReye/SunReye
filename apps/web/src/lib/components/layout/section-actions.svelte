<script lang="ts">
	// The chrome the caller asked for — the contents of the header's second grid
	// column, zone 2. Its own file because the header
	// template crossed the complexity gate once the toggle joined the caret there
	// — guarded branches that have nothing to do with the title block.
	//
	// It renders NO box of its own. Column two is one grid cell holding this and
	// the collapse caret, so the cell is `section-header`'s to draw; a wrapper here
	// would nest a second flex row with a second copy of the cluster gap.
	//
	// Placement is therefore the header grid's business and not this file's: the
	// column is hard right at every width, and nothing here can move it.
	// The full-screen toggle used to render here too, and the argument for that
	// was sound as far as it went: the header already names the chart, and a
	// button in the plot's corner sits on the surface a mouse brushes on. What
	// outweighed it was the reported mispress — in this cluster ⤢ was one 44px
	// box from the collapse caret, and they are hit for each other. It is in the
	// plot's bottom-right corner now, diagonally opposite the zoom reset, with
	// the brush cost accounted for in `plot-frame.svelte` and the release-over-
	// the-corner case guarded in `fullscreen-trigger.svelte`.
	import type { Snippet } from 'svelte';

	let { actions }: { actions?: Snippet } = $props();
</script>

{@render actions?.()}

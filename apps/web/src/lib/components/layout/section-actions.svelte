<script lang="ts">
	// The chrome the caller asked for — the contents of the header's second grid
	// column, zone 2. Its own file because the header
	// template crossed the complexity gate once the toggle joined the caret there
	// — guarded branches that have nothing to do with the title block.
	//
	// It renders NO box of its own. Column two is a single grid cell holding two
	// things (this and the collapse caret), so the cell is `section-header`'s to
	// draw; a box here as well would nest a second flex row, with a second copy of
	// the cluster gap, inside the first — and it would break the one measurement
	// that proves this whole change, `e2e/statistics-mobile-density.spec.ts`, which
	// compares the cluster's right edge against its PARENT's. With a wrapper in
	// between, that parent is the cluster's own cell and the comparison is
	// trivially true whatever the layout does.
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

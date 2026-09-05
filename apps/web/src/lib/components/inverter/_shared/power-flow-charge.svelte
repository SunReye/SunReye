<script lang="ts">
	// One charge of energy flying along one rail.
	//
	// A chain of beads, each with its own `<animateMotion>` down the same cable,
	// lagging the one ahead of it. That is what makes the comet BEND: a dash
	// pattern can only taper by opacity, and a single sprite can only be placed
	// and rotated, so on this diagram's Béziers it cuts the corner and reads as a
	// straight splinter laid across a curved wire. Every part of the comet being
	// separately on the path follows the curve exactly, and the chain's blur fuses
	// the beads into one tapered streak with an incandescent head.
	//
	// Its own component because the rails' template would otherwise carry two
	// nested loops and a key block around this, which is the kind of density the
	// repo's complexity gate rejects — and rightly: the bead chain is one idea.
	import { beadBegin, beadShape, BEAD_COUNT, moverKeyPoints } from '$lib/inverter/flow-pulse';
	import type { Flow } from '$lib/inverter/power-graph';
	import type { RailPulse } from '$lib/inverter/flow-pulse';

	let {
		pulse,
		flow,
		cable
	}: {
		pulse: RailPulse;
		flow: Flow;
		/** Element id of the rail's cable — the motion path, via `<mpath>`. */
		cable: string;
	} = $props();

	/** Bead indices, so the markup stays a plain keyed loop. */
	const beads = Array.from({ length: BEAD_COUNT }, (_, k) => k);

	/** The head bead's radius at scale 1, px. Every other bead is a fraction. */
	const BEAD_RADIUS = 6;
</script>

<!-- Keyed on the crossing time: a quantized step rebuilds the chain so SMIL
     starts the new speed from the top of the path, rather than remapping the
     running animation and teleporting the charge to wherever the new duration
     says it should be by now. -->
{#key pulse.dur}
	<g class="charge" style={`--mv-blur:${pulse.blur}px;--mv-glow:${pulse.glow}px`}>
		{#each beads as k (k)}
			<circle
				class={k === 0 ? 'bead bead-hot' : 'bead'}
				r={beadShape(k).radius * BEAD_RADIUS * pulse.scale}
				opacity={beadShape(k).opacity}
			>
				<animateMotion
					dur={`${pulse.dur}s`}
					repeatCount="indefinite"
					begin={beadBegin(k, pulse.dur)}
					keyPoints={moverKeyPoints(flow)}
					keyTimes="0;1"
					calcMode="linear"
				>
					<mpath href={`#${cable}`} />
				</animateMotion>
			</circle>
		{/each}
	</g>
{/key}

<style>
	/* Registered so they can be transitioned at all: an unregistered custom
	   property is an untyped token stream and would jump between samples. */
	@property --mv-blur {
		syntax: '<length>';
		inherits: true;
		initial-value: 1px;
	}
	@property --mv-glow {
		syntax: '<length>';
		inherits: true;
		initial-value: 4px;
	}

	.charge {
		/* Blur is what fuses the separate beads into one streak — without it the
		   comet reads as a row of dots. The two shadows are the near and far
		   halves of the bloom, both in the rail's own sign colour inherited from
		   the group above, so there is no second palette to keep in step. One
		   filter on the whole chain rather than one per bead: two dozen filter
		   regions per rail is the shape of the render cost this diagram already
		   learned to avoid once. */
		filter: blur(var(--mv-blur)) drop-shadow(0 0 var(--mv-glow) currentColor)
			drop-shadow(0 0 calc(var(--mv-glow) * 3) currentColor);
		/* Intensity glides between 1 Hz samples. Neither is a timing property: a
		   charge brightens where it already is. */
		transition:
			--mv-blur 700ms linear,
			--mv-glow 700ms linear;
	}

	.bead {
		fill: currentColor;
	}
	/* The incandescent head. Lightness, not hue: the mix keeps the rail's own
	   sign colour and only drives it toward white, the way anything bright enough
	   reads. Without it a charge saturates at its flat token colour and never
	   looks hot. */
	.bead-hot {
		fill: color-mix(in oklab, currentColor 25%, white);
	}
</style>

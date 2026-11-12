<!--
  One charge of energy flying along one rail. Ported from v3 (dev 780b4e2, power-flow-charge.svelte).
  A chain of beads, each on its own `animateMotion` down the same cable and lagging the one ahead,
  so the comet bends with the curve. The chain's blur fuses the beads into one tapered streak.
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { beadBegin, beadShape, BEAD_COUNT, carryHead, moverKeyPoints, type ChainHead, type RailPulse } from "./flow-pulse";
  import type { Flow } from "./power-graph";

  let { pulse, flow, cable }: { pulse: RailPulse; flow: Flow; /** Id of the rail's cable, the motion path. */ cable: string } = $props();

  const beads = Array.from({ length: BEAD_COUNT }, (_, k) => k);
  /** The head bead's radius at scale 1, px. */
  const BEAD_RADIUS = 6;

  /** The host group: its SVG's clock is the one `begin` resolves against. */
  let host = $state.raw<SVGGElement | undefined>();

  // The head's `begin`, carried across a rebuild so the new chain starts where the old one was.
  // Plain memory, not state: written only while deriving, read by nothing else.
  let last: ChainHead | undefined;
  const head = $derived.by(() => {
    last = carryHead(last, pulse.dur, () => untrack(() => host)?.ownerSVGElement?.getCurrentTime());
    return last.head;
  });
</script>

<!-- Keyed on the crossing time: a quantised step rebuilds the chain instead of remapping the running
     animation, which would teleport the charge. The rebuilt chain begins where the old head was. -->
<g bind:this={host}>
  {#key pulse.dur}
    <g class="charge" style="--mv-blur:{pulse.blur}px;--mv-glow:{pulse.glow}px">
      {#each beads as k (k)}
        <circle class={k === 0 ? "bead bead-hot" : "bead"} r={beadShape(k).radius * BEAD_RADIUS * pulse.scale} opacity={beadShape(k).opacity}>
          <animateMotion
            dur="{pulse.dur}s"
            repeatCount="indefinite"
            begin={beadBegin(k, pulse.dur, head)}
            keyPoints={moverKeyPoints(flow)}
            keyTimes="0;1"
            calcMode="linear"
          >
            <mpath href="#{cable}" />
          </animateMotion>
        </circle>
      {/each}
    </g>
  {/key}
</g>

<style>
  /* Registered so they can transition: an unregistered custom property would jump between samples. */
  @property --mv-blur {
    syntax: "<length>";
    inherits: true;
    initial-value: 1px;
  }
  @property --mv-glow {
    syntax: "<length>";
    inherits: true;
    initial-value: 4px;
  }

  .charge {
    /* One filter on the whole chain, not one per bead. The blur radius is static per pulse (ADR 21);
       the glow's reach glides between samples. */
    filter: blur(var(--mv-blur)) drop-shadow(0 0 var(--mv-glow) currentColor) drop-shadow(0 0 calc(var(--mv-glow) * 3) currentColor);
    transition: --mv-glow 700ms linear;
  }
  .bead {
    fill: currentColor;
  }
  /* The incandescent head: lightness, not hue. */
  .bead-hot {
    fill: color-mix(in oklab, currentColor 25%, white);
  }
</style>

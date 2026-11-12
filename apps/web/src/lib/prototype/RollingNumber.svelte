<!--
  PROTOTYPE: odometer digits. `value` may be fractional while a wheel moves, so each digit
  rolls continuously up or down with the motion; only transforms change.
-->
<script lang="ts">
  let { value, max, pad = 0 }: { value: number; max: number; pad?: number } = $props();

  const columns = $derived(Math.max(String(Math.floor(Math.abs(max))).length, pad, 1));
  const v = $derived(Math.max(0, value));

  /** Position of column k on its 0-9-0 strip: odometer carry in the last tenth. */
  function position(k: number, x: number): number {
    const unit = 10 ** k;
    const digitValue = x / unit;
    const base = Math.floor(digitValue) % 10;
    if (k === 0) return x % 10;
    const lower = x % unit;
    const carry = Math.max(0, (lower - (unit - 1)) / 1);
    return base + Math.min(1, carry);
  }

  function visible(k: number, x: number): number {
    if (k === 0 || k < pad) return 1;
    return Math.max(0, Math.min(1, x - (10 ** k - 1)));
  }
</script>

<span class="roll" aria-hidden="true">
  {#each { length: columns } as _, i (i)}
    {@const k = columns - 1 - i}
    {@const o = visible(k, v)}
    {#if o > 0 || k === 0}
      <span class="col" style:opacity={o}>
        <span class="strip" style:transform="translateY({-position(k, v)}em)">
          {#each [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0] as d, j (j)}
            <span class="digit">{d}</span>
          {/each}
        </span>
      </span>
    {/if}
  {/each}
</span>

<style>
  .roll {
    display: inline-flex;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    height: 1em;
    overflow: hidden;
    /* Digits fade at the top and bottom edge as they roll. */
    mask-image: linear-gradient(transparent, #000 18%, #000 82%, transparent);
    padding-block: 0.08em;
    box-sizing: content-box;
  }
  .col {
    display: inline-block;
    height: 1em;
    width: 0.62em;
  }
  .strip {
    display: flex;
    flex-direction: column;
    height: 11em;
    will-change: transform;
  }
  .strip > .digit {
    height: 1em;
    display: block;
    text-align: center;
  }
</style>

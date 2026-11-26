<!-- The rule at the place a chart is read (ADR 21 "Chart reading"), at `share` of the plot's width;
  the plot is its positioned parent. -->
<script lang="ts">
  let { share }: { share: number } = $props();
</script>

<span
  class="pointer-events-none absolute inset-y-0 w-px bg-foreground/60"
  style:left="{share * 100}%"
  data-read
></span>

<!-- v3's mark: a flat sun in the brand blue (ADR 21). -->
<script lang="ts">
  let { class: className = "size-7" }: { class?: string } = $props();
</script>

<svg
  viewBox="0 0 48 48"
  class={["text-brand", className]}
  fill="none"
  role="img"
  aria-label="SunReye"
>
  <g stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
    <line x1="24" y1="4" x2="24" y2="9.5" /><line x1="24" y1="38.5" x2="24" y2="44" />
    <line x1="4" y1="24" x2="9.5" y2="24" /><line x1="38.5" y1="24" x2="44" y2="24" />
    <line x1="10.1" y1="10.1" x2="14" y2="14" /><line x1="34" y1="34" x2="37.9" y2="37.9" />
    <line x1="37.9" y1="10.1" x2="34" y2="14" /><line x1="14" y1="34" x2="10.1" y2="37.9" />
  </g>
  <circle cx="24" cy="24" r="8" fill="currentColor" />
</svg>

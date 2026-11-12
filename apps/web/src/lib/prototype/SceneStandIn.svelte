<!--
  PROTOTYPE: what the hero shows while the 3D scene loads behind it: the scene's own studio
  backdrop, computed with the scene's formula so the fade-in changes nothing but the house, and a
  quiet shadow where the house will stand. No spinner: a line of text appears only if loading
  takes longer than a second. Not the 2D flow: a second diagram that is swapped away unasked
  would be read, and tapped, and then move.
-->
<script lang="ts">
  let { dark, slow = false }: { dark: boolean; slow?: boolean } = $props();

  const N = 64;
  const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

  /** The same vignette Scene3d's `studioBackdrop` lands on after tone mapping, in page colours. */
  function paint(canvas: HTMLCanvasElement): void {
    // Tracked: the page colour follows the theme.
    const isDark = dark;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = getComputedStyle(canvas).getPropertyValue("--background");
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    const page = [toLinear(r! / 255), toLinear(g! / 255), toLinear(b! / 255)];
    const lift = isDark ? [0.06, 0.065, 0.075] : [1, 1, 1];
    const centre = page.map((p, i) => p + (lift[i]! - p) * (isDark ? 0.4 : 0.55));
    const edge = page.map((p) => p * (isDark ? 0.7 : 0.93));
    const img = ctx.createImageData(N, N);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const d = Math.min(1, Math.hypot(x / N - 0.5, (y / N - 0.42) * 1.15) * 1.6);
        const t = d * d * (3 - 2 * d);
        for (let k = 0; k < 3; k++) {
          const c = t < 0.5 ? centre[k]! + (page[k]! - centre[k]!) * t * 2 : page[k]! + (edge[k]! - page[k]!) * (t - 0.5) * 2;
          img.data[(y * N + x) * 4 + k] = toSrgb(c) * 255;
        }
        img.data[(y * N + x) * 4 + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
  }
</script>

<div class="absolute inset-0 overflow-hidden" aria-hidden={!slow}>
  <canvas {@attach paint} width={N} height={N} class="absolute inset-0 size-full"></canvas>
  <div class="ground absolute top-[47%] left-[8%] h-[38%] w-[84%]"></div>
  <p class={["absolute bottom-4 left-4 text-xs text-muted-foreground transition-opacity duration-200", slow ? "opacity-100" : "opacity-0"]} role="status">
    {#if slow}3D-Ansicht lädt …{/if}
  </p>
</div>

<style>
  /* Where the plot will lie: barely there, so nothing seems to be missing and nothing jumps. */
  .ground {
    background: radial-gradient(closest-side, rgb(0 0 0 / 0.1), rgb(0 0 0 / 0.04) 55%, transparent);
  }
</style>

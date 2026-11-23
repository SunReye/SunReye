<!--
  What the hero shows while the 3D scene loads behind it (ADR 20 Loading): the scene's own studio
  backdrop, so the fade-in changes nothing but the house, and a quiet shadow where the house will
  stand. No spinner: a line of text appears only once loading takes longer than a second. Not the
  2D flow: a diagram swapped away unasked would be read, tapped, and then move.
-->
<script lang="ts">
  import { mode } from "mode-watcher";
  import { m } from "../paraglide/messages.js";
  import { backdropAt, type Linear } from "@sunreye/builder/canvas";

  let { slow = false }: { slow?: boolean } = $props();

  const SIZE = 64;
  const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

  /** The backdrop the scene's studio lands on after tone mapping, in page colours. */
  function paint(canvas: HTMLCanvasElement): void {
    // Tracked: the page colour follows the theme.
    const dark = mode.current === "dark";
    const context = canvas.getContext("2d", { willReadFrequently: true });

    if (context === null) return;

    context.fillStyle = getComputedStyle(canvas).getPropertyValue("--background");
    context.fillRect(0, 0, 1, 1);

    const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
    const page: Linear = [toLinear(r / 255), toLinear(g / 255), toLinear(b / 255)];
    const image = context.createImageData(SIZE, SIZE);

    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const colour = backdropAt(page, dark, x / SIZE, y / SIZE);
        const i = (y * SIZE + x) * 4;

        image.data.set([...colour.map((c) => toSrgb(c) * 255), 255], i);
      }

    context.putImageData(image, 0, 0);
  }
</script>

<div class="absolute inset-0 overflow-hidden" aria-hidden={!slow}>
  <canvas {@attach paint} width={SIZE} height={SIZE} class="absolute inset-0 size-full"></canvas>
  <div class="ground absolute top-[47%] left-[8%] h-[38%] w-[84%]"></div>
  <p
    class={[
      "absolute bottom-4 left-4 text-xs text-muted-foreground transition-opacity duration-(--motion-base)",
      slow ? "opacity-100" : "opacity-0",
    ]}
    role="status"
  >
    {#if slow}{m.dash_scene_loading()}{/if}
  </p>
</div>

<style>
  /* Where the plot will lie: barely there, so nothing seems missing and nothing jumps. */
  .ground {
    background: radial-gradient(closest-side, rgb(0 0 0 / 0.1), rgb(0 0 0 / 0.04) 55%, transparent);
  }
</style>

<!--
  Templates over an empty scene (ADR 20): large tappable cards, each with a still 3D picture of
  what it places. The nearest shape is one tap; "start empty" leaves the scene to the inspector.
-->
<script lang="ts">
  import * as Card from "#lib/components/ui/card/index.js";
  import Plus from "@lucide/svelte/icons/plus";
  import { m } from "../paraglide/messages.js";
  import type { Pv } from "./pv.ts";
  import type { Draft } from "./modules.ts";
  import { blocksOf, fill, TEMPLATES, type Template } from "./templates.ts";
  import { thumbnail } from "./thumbnail.ts";

  let {
    pv,
    draft,
    clear = 0,
    onpick,
  }: {
    pv: Pick<Pv, "geometry">;
    /** What a template fills. */
    draft: Draft;
    /** Pixels at the bottom a sheet keeps covered. */
    clear?: number;
    /** The draft a template filled; none to start empty. */
    onpick: (filled?: Draft) => void;
  } = $props();

  const NAMES: Readonly<Record<Template, () => string>> = {
    gable: m.builder_template_gable,
    bungalow: m.builder_template_bungalow,
    hip: m.builder_template_hip,
    lHouse: m.builder_template_l_shape,
    terraceEnd: m.builder_template_terrace_end,
    empty: m.builder_template_empty,
  };

  /** Each template's picture, with the compass at 0° as every one faces south. */
  const pictures = $derived(
    TEMPLATES.map((template) => ({
      template,
      picture:
        template === "empty"
          ? undefined
          : thumbnail(
              pv.geometry({ north: 0, blocks: blocksOf(template, 0), obstacles: [], grids: [] })
                .faces,
            ),
    })),
  );
</script>

<section
  aria-labelledby="builder-templates"
  class="absolute inset-0 overflow-hidden rounded-lg bg-background/50"
>
  <!-- The scroller is inside the veil: a mask on the veil would fade its tint too (ADR 21). The
    veil and the card lie over the 3D canvas: neither blurs it. -->
  <div
    class="grid size-full place-items-center overflow-y-auto p-6 scroll-fade-y no-scrollbar"
    style:padding-bottom="{clear + 24}px"
  >
    <Card.Root class="canvas-chip w-full max-w-3xl gap-0 p-5">
      <h2 id="builder-templates" class="text-[15px] font-semibold">{m.builder_templates()}</h2>
      <p class="mt-1 text-sm text-muted-foreground">{m.builder_templates_hint()}</p>
      <ul class="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {#each pictures as { template, picture } (template)}
          <li>
            <Card.Root
              interactive
              class="canvas-chip w-full gap-0 py-0"
              onclick={() => {
                onpick(template === "empty" ? undefined : fill(draft, template));
              }}
            >
              <span class="flex h-32 items-center justify-center bg-muted/40 p-3" aria-hidden="true">
                {#if picture === undefined}
                  <Plus class="size-8 text-muted-foreground" />
                {:else}
                  <svg class="h-full w-full" viewBox={picture.box.join(" ")}>
                    {#each picture.polygons as polygon, i (i)}
                      <polygon
                        points={polygon.points}
                        fill={polygon.fill}
                        stroke={polygon.fill}
                        stroke-width="0.04"
                        stroke-linejoin="round"
                      />
                    {/each}
                  </svg>
                {/if}
              </span>
              <span class="px-3 py-2.5 text-sm font-medium">{NAMES[template]()}</span>
            </Card.Root>
          </li>
        {/each}
      </ul>
    </Card.Root>
  </div>
</section>

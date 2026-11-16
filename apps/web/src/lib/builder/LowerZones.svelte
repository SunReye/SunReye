<!--
  The canvas's lower zones (ADR 20): one status line at the left, the tools at the right, and
  under them, on the canvas's edge, the credits of imported surroundings while they are drawn.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import type { ComponentProps } from "svelte";
  import SceneCredits from "../scene/SceneCredits.svelte";
  import StatusStrip from "./StatusStrip.svelte";

  let {
    status,
    credits,
    clear,
    covered,
    tools,
  }: {
    status: ComponentProps<typeof StatusStrip>;
    /** Who the imported surroundings drawn are owed to; none, none drawn. */
    credits: readonly string[];
    /** Pixels at the bottom a peeking sheet keeps covered. */
    clear: number;
    /** Whether a pulled-up sheet covers the zones: they go, instead of lying under it. */
    covered: boolean;
    /** Buttons at the lower right, beside the status line. */
    tools?: Snippet | undefined;
  } = $props();
</script>

<div
  class={[
    "pointer-events-none absolute inset-x-3 flex flex-col gap-1 transition-[opacity,visibility] duration-(--motion-fast) ease-(--motion-ease)",
    credits.length > 0 ? "bottom-1" : "bottom-3",
    covered && "invisible opacity-0",
  ]}
  style:margin-bottom="{clear}px"
>
  <!-- One row: the status line takes what the tools leave, so the two never overlap. -->
  <div class="flex items-end gap-2">
    <div class="flex min-w-0 flex-1">
      <StatusStrip {...status} />
    </div>
    {#if tools}
      <div class="pointer-events-auto shrink-0">
        {@render tools()}
      </div>
    {/if}
  </div>
  <SceneCredits {credits} />
</div>

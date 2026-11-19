<!--
  The context toolbar (ADR 20): what is selected carries its commonest actions on the canvas, above
  it or, without room, below it, inside the canvas and clear of its fixed zones. It follows the
  selection as the camera moves; nothing selected, no toolbar.
-->
<script lang="ts" module>
  import type { Session } from "./session.svelte.ts";

  export type Selected = Session;
</script>

<script lang="ts">
  import { m } from "../paraglide/messages.js";
  import ContextActions from "./ContextActions.svelte";
  import { measured } from "./canvas-zones.ts";
  import type { Point } from "./pv.ts";
  import { boxOf, carried } from "./toolbar-anchor.ts";
  import { placed } from "./toolbar-place.ts";

  let {
    session,
    project,
    canvas,
    clear,
  }: {
    session: Session;
    /** Where a point of the scene lands on the canvas, as last drawn; null behind the camera. */
    project: (point: Point) => readonly [number, number] | null;
    /** The canvas the toolbar stands in, whose zones it keeps clear of. */
    canvas: HTMLElement;
    /** Pixels at the canvas's bottom a peeking sheet covers. */
    clear: number;
  } = $props();

  let width = $state(0);
  let height = $state(0);

  /** Why the last action was not done, until the selection changes. */
  let refused = $state<{ readonly at: string; readonly reason: string }>();

  const selecting = $derived(session.wiring.selection.length > 0);
  const key = $derived(JSON.stringify(session.level));

  const kind = $derived(carried(session.level, selecting));
  const box = $derived(boxOf(session, project));

  // Measured anew with every drawn frame, which `project` stands for: the zones come and go.
  const place = $derived(box && placed(box, { width, height }, measured(canvas, clear)));

  const own = $derived(refused?.at === key ? refused.reason : undefined);
  const reason = $derived(selecting ? session.wiring.refused : own);
</script>

{#if kind !== null && place !== null}
  <div
    role="toolbar"
    aria-label={selecting ? m.builder_selection() : m.builder_context()}
    bind:clientWidth={width}
    bind:clientHeight={height}
    class={[
      "glass-ambient pointer-events-auto absolute top-0 left-0 flex max-w-[calc(100%-1.5rem)] flex-col rounded-md p-0.5 ring-1 ring-border/60 elevation-1",
      // Measured before it is shown: it never jumps into place.
      width === 0 && "invisible",
    ]}
    style:transform="translate({Math.round(place.left)}px, {Math.round(place.top)}px)"
  >
    <div class="flex items-center gap-0.5">
      <ContextActions
        {kind}
        {session}
        onrefuse={(why) => {
          refused = why === undefined ? undefined : { at: key, reason: why };
        }}
      />
    </div>
    {#if reason !== undefined}
      <p role="alert" class="max-w-64 px-2 pb-1.5 text-sm text-destructive">{reason}</p>
    {/if}
  </div>
{/if}

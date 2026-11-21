<!-- The value editor (ADR 21): an anchored glass popover with a mouse, a bottom drawer on touch. -->
<script lang="ts">
  import { Popover } from "bits-ui";
  import { input } from "../../shell/input.svelte.ts";
  import DrawerSheet from "../drawer-sheet.svelte";
  import type { Editable, Outcome } from "./editable.ts";
  import EditorBody from "./editor-body.svelte";

  let {
    key,
    edit,
    current,
    anchor,
    open = $bindable(false),
    onapply,
    below = false,
  }: {
    /** Which setting it edits: a new one starts a fresh editor. */
    key: string;
    edit: Editable;
    /** The device's value; `null` when unknown. */
    current: number | null;
    anchor: HTMLElement | null;
    open?: boolean;
    onapply: (value: number) => Promise<Outcome>;
    /** Open under the row's value instead of beside the row (two panes fill the width). */
    below?: boolean;
  } = $props();

  // Beside the row in the drill-in, under the row's value in two panes.
  const placement = $derived(
    below
      ? ({ side: "bottom", align: "end", sideOffset: 6 } as const)
      : ({ side: "right", align: "center", sideOffset: 14 } as const),
  );

  async function apply(value: number): Promise<Outcome> {
    const outcome = await onapply(value);

    if (outcome.kind === "confirmed") open = false;

    return outcome;
  }
</script>

{#if input.overlay === "popover"}
  <Popover.Root bind:open>
    <Popover.Portal>
      <Popover.Content
        customAnchor={anchor}
        {...placement}
        collisionPadding={12}
        class="glass-modal glass-ambient z-50 w-[300px] origin-(--bits-popover-content-transform-origin) rounded-lg p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 elevation-4 outline-none duration-(--motion-base) ease-(--motion-ease) data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-open:animate-spring-in data-open:fade-in-0 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2"
      >
        {#key key}
          <EditorBody {edit} {current} onapply={apply} compact />
        {/key}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
{:else}
  <DrawerSheet bind:open label={edit.name}>
    <div class="px-5 pt-2 pb-2">
      {#key key}
        <EditorBody {edit} {current} onapply={apply} />
      {/key}
    </div>
  </DrawerSheet>
{/if}

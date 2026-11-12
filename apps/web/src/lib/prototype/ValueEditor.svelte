<!-- PROTOTYPE: value editor container: anchored glass popover with a mouse, bottom drawer on touch (ADR 21). -->
<script lang="ts">
  import { Popover } from "bits-ui";
  import BottomSheet from "./BottomSheet.svelte";
  import EditorBody from "./EditorBody.svelte";
  import { input } from "./input.svelte";
  import type { Setting } from "./settings";

  let {
    setting,
    anchor,
    open = $bindable(false),
    onapply,
  }: {
    setting: Setting | null;
    anchor: HTMLElement | null;
    open?: boolean;
    onapply: (value: number | string) => Promise<void>;
  } = $props();

  async function apply(v: number | string): Promise<void> {
    await onapply(v);
    open = false;
  }
</script>

{#if input.mouse}
  <Popover.Root bind:open>
    <Popover.Portal>
      <Popover.Content
        customAnchor={anchor}
        side="right"
        align="center"
        sideOffset={14}
        collisionPadding={12}
        class="glass-modal glass-ambient z-50 w-[300px] rounded-xl p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 elevation-4 outline-none duration-(--motion-base) ease-(--motion-ease) data-open:animate-spring-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-[side=right]:slide-in-from-left-2 data-[side=left]:slide-in-from-right-2 origin-(--bits-popover-content-transform-origin)"
      >
        {#if setting}
          {#key setting.id}
            <EditorBody {setting} onapply={apply} compact />
          {/key}
        {/if}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
{:else}
  <BottomSheet bind:open label={setting?.label ?? "Wert"}>
    <div class="px-5 pt-2 pb-2">
      {#if setting}
        {#key setting.id}
          <EditorBody {setting} onapply={apply} />
        {/key}
      {/if}
    </div>
  </BottomSheet>
{/if}

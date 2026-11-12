<!-- One setting and its current value; a writable row opens the value editor (ADR 21). -->
<script lang="ts">
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import * as Item from "#lib/components/ui/item/index.js";
  import type { Control } from "./groups.ts";

  let {
    control,
    value,
    note,
    active,
    onedit,
  }: {
    control: Control;
    /** Its current value as text. */
    value: string;
    /** Under the name: why it is read-only, or its device. */
    note: string | undefined;
    /** The editor has it open. */
    active: boolean;
    onedit: (control: Control, row: HTMLElement) => void;
  } = $props();
</script>

<Item.Root class="rounded-none border-0">
  {#snippet child({ props })}
    <button
      {...props}
      type="button"
      onclick={(e) => {
        if (control.writable) onedit(control, e.currentTarget);
      }}
      aria-haspopup={control.writable ? "dialog" : undefined}
      aria-disabled={!control.writable}
      class={[
        props.class,
        "text-left",
        control.writable ? "hover:bg-muted/60 active:bg-muted" : "cursor-default",
        active && "bg-muted",
      ]}
    >
      <Item.Content>
        <Item.Title class="text-[15px] leading-snug font-normal text-wrap"
          >{control.setting.name ?? control.setting.key}</Item.Title
        >
        {#if note}<Item.Description>{note}</Item.Description>{/if}
      </Item.Content>
      <Item.Actions class="gap-2">
        <span class="text-[15px] font-medium whitespace-nowrap tabular-nums">{value}</span>
        {#if control.writable}<ChevronRight class="size-4 text-muted-foreground" />{/if}
      </Item.Actions>
    </button>
  {/snippet}
</Item.Root>

<!-- An inspector row whose bounded number or choice opens the value editor (ADR 21); applying edits the draft. -->
<script lang="ts">
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import * as Item from "#lib/components/ui/item/index.js";
  import type { Editable, Outcome } from "../components/value-editor/editable.ts";
  import ValueEditor from "../components/value-editor/value-editor.svelte";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";

  let {
    edit,
    value,
    missing = false,
    onchange,
  }: {
    /** Its name is the row's label. */
    edit: Editable;
    value: number;
    /** A required value not yet entered: the row says so in place of the value. */
    missing?: boolean;
    onchange: (value: number) => void;
  } = $props();

  let row = $state<HTMLButtonElement | null>(null);
  let open = $state(false);

  const format = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 2 });

  const text = $derived(
    edit.kind === "enum"
      ? (edit.options.find((option) => option.value === value)?.text ?? "")
      : format.format(value),
  );

  // A draft edit cannot be refused: the editor closes on it at once.
  function apply(next: number): Promise<Outcome> {
    onchange(next);

    return Promise.resolve({ kind: "confirmed" });
  }
</script>

<Item.Root class="rounded-none border-0">
  {#snippet child({ props })}
    <button
      {...props}
      bind:this={row}
      type="button"
      aria-haspopup="dialog"
      onclick={() => {
        open = true;
      }}
      class={[props.class, "text-left hover:bg-muted/60 active:bg-muted", open && "bg-muted"]}
    >
      <Item.Content>
        <Item.Title class="text-[15px] leading-snug font-normal text-wrap">{edit.name}</Item.Title>
      </Item.Content>
      <Item.Actions class="gap-2">
        {#if missing}
          <span class="text-[15px] whitespace-nowrap text-destructive">{m.builder_required()}</span>
        {:else}
          <span class="text-[15px] font-medium whitespace-nowrap tabular-nums">{text}</span>
        {/if}
        <ChevronRight class="size-4 text-muted-foreground" />
      </Item.Actions>
    </button>
  {/snippet}
</Item.Root>
<ValueEditor key={edit.name} {edit} current={value} anchor={row} bind:open onapply={apply} />

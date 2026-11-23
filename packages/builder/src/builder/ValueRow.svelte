<!-- An inspector row whose bounded number or choice opens the value editor (ADR 21); applying edits the draft. -->
<script lang="ts">
  import { Pressable } from "@sunreye/ui/pressable";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import * as Item from "@sunreye/ui/item";
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
    <Pressable
      feedback
      {...props}
      bind:ref={row}
      aria-haspopup="dialog"
      onclick={() => {
        open = true;
      }}
      selected={open}
      class={[props.class, "text-left"]}
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
    </Pressable>
  {/snippet}
</Item.Root>
<ValueEditor key={edit.name} {edit} current={value} anchor={row} bind:open onapply={apply} />

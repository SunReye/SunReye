<!-- The investment payback counts against, as a row that opens the value editor; applying saves it. -->
<script lang="ts">
  import { Pressable } from "@sunreye/ui/pressable";
  import type { Core, Problem } from "../api/core";
  import type { Outcome } from "@sunreye/builder/components/value-editor/editable.ts";
  import ValueEditor from "../components/value-editor/value-editor.svelte";
  import * as Item from "@sunreye/ui/item";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import { problemText } from "../i18n/problems";
  import { m } from "../paraglide/messages.js";
  import { euros } from "./format";

  let {
    core,
    investment,
    oninvested,
  }: { core: Core; investment: number | null; oninvested: () => void } = $props();

  const edit = {
    kind: "number" as const,
    name: m.tariff_investment_field(),
    unit: "",
    min: 0.01,
    max: 1_000_000,
    step: 0.01,
  };

  let row = $state<HTMLButtonElement | null>(null);
  let open = $state(false);

  // The core's refusal shows in the editor, which stays open for a fix.
  async function apply(amount: number): Promise<Outcome> {
    const refused: Problem | undefined = await core.invest(amount);

    if (refused) return { kind: "refused", reason: problemText(refused.problem) };

    oninvested();

    return { kind: "confirmed" };
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
      class={[props.class, "flex-nowrap text-left"]}
    >
      <Item.Content class="min-w-0">
        <Item.Title class="text-[15px] font-normal">{m.tariff_investment()}</Item.Title>
      </Item.Content>
      <Item.Actions class="gap-2">
        <span class="text-[15px] font-medium whitespace-nowrap tabular-nums">
          {investment === null ? "–" : euros(investment)}
        </span>
        <ChevronRight class="size-4 text-muted-foreground" />
      </Item.Actions>
    </Pressable>
  {/snippet}
</Item.Root>
<ValueEditor key={edit.name} {edit} current={investment} anchor={row} bind:open onapply={apply} />

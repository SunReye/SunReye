<!--
  A new module type from its datasheet (ADR 17), in the face's level: name, then the datasheet's
  groups as value-editor rows. The core judges the values; its refusal shows above the buttons and
  everything entered stays for a fix.
-->
<script lang="ts">
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Item from "#lib/components/ui/item/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import type { Datasheet, ModuleType, Problem } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import Refusal from "../setup/Refusal.svelte";
  import { BLANK, datasheet, rows, type Entered } from "./datasheet.ts";
  import ValueRow from "./ValueRow.svelte";

  let {
    add,
    onadded,
    oncancel,
  }: {
    add: (datasheet: Readonly<Datasheet>) => Promise<ModuleType | Problem>;
    onadded: (added: ModuleType) => void;
    oncancel: () => void;
  } = $props();

  const uid = $props.id();
  const groups = rows();

  let name = $state("");
  let entered = $state.raw<Entered>(BLANK);
  let refused = $state.raw<Problem>();
  let adding = $state(false);

  async function submit(): Promise<void> {
    adding = true;

    const answer = await add(datasheet(name, entered));

    adding = false;

    if ("problem" in answer) refused = answer;
    else onadded(answer);
  }
</script>

<form
  class="flex flex-col"
  onsubmit={(event) => {
    event.preventDefault();
    void submit();
  }}
>
  <label class="flex flex-col gap-1.5 px-4 pt-3 pb-1 text-sm text-muted-foreground">
    {m.field_name()}
    <Input bind:value={name} autocomplete="off" />
  </label>

  {#each groups as group, g (group.title)}
    <h3 id="{uid}-{g}" class="px-4 pt-4 pb-1 text-xs font-medium text-muted-foreground">
      {group.title}
    </h3>
    <Item.Group aria-labelledby="{uid}-{g}" class="gap-0 divide-y divide-border/60">
      {#each group.rows as [key, edit] (key)}
        <ValueRow
          {edit}
          value={entered[key]}
          onchange={(value) => {
            entered = { ...entered, [key]: value };
          }}
        />
      {/each}
    </Item.Group>
  {/each}

  <div class="flex flex-col gap-2 border-t border-border/60 p-3">
    <Refusal {refused} />
    <Button type="submit" disabled={adding || name.trim() === ""}>
      {m.builder_create_module_type()}
    </Button>
    <Button type="button" variant="ghost" onclick={oncancel}>{m.builder_cancel()}</Button>
  </div>
</form>

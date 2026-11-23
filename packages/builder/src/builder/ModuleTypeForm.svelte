<!--
  A new module type from its datasheet (ADR 17), in the face's level: name, then the datasheet's
  groups as value-editor rows. The core judges the values; its refusal shows above the buttons and
  everything entered stays for a fix.
-->
<script lang="ts">
  import { Button } from "@sunreye/ui/button";
  import * as Item from "@sunreye/ui/item";
  import { Input } from "@sunreye/ui/input";
  import { type Datasheet, host, type ModuleType, type Problem } from "./host.ts";
  import { m } from "../paraglide/messages.js";
  import ProblemAlert from "../components/problem-alert.svelte";
  import { answered } from "../feedback.ts";
  import { BLANK, datasheet, missing, REQUIRED, rows, type Entered } from "./datasheet.ts";
  import { valueRefusal } from "./checks.ts";
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
  const { refusal } = host();

  let refused = $state.raw<Problem>();
  let adding = $state(false);

  const labels = Object.fromEntries(
    groups.flatMap((group) => group.rows.map(([key, edit]) => [key, edit.name])),
  );

  const complete = $derived([...REQUIRED].every((key) => !missing(entered, key)));

  /** The refusal worded by the value it points at, else by its code alone. */
  const pointed = $derived(refused === undefined ? undefined : valueRefusal(refused, labels));

  async function submit(): Promise<void> {
    adding = true;

    const answer = await add(datasheet(name, entered));

    adding = false;

    if ("problem" in answer) refused = answered(answer);
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
          missing={missing(entered, key)}
          onchange={(value) => {
            entered = { ...entered, [key]: value };
          }}
        />
      {/each}
    </Item.Group>
  {/each}

  <div class="flex flex-col gap-2 border-t border-border/60 p-3">
    <ProblemAlert text={pointed ?? (refused && refusal(refused.problem))} />
    <Button type="submit" disabled={adding || name.trim() === "" || !complete}>
      {m.builder_create_module_type()}
    </Button>
    <Button type="button" variant="ghost" onclick={oncancel}>{m.builder_cancel()}</Button>
  </div>
</form>

<!-- A string's level in the inspector: its name, module type, wiring and loss. -->
<script lang="ts">
  import * as Item from "@sunreye/ui/item";
  import { Input } from "@sunreye/ui/input";
  import type { Device, ModuleType, StringDraft } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import { amount, choices } from "./fields.ts";
  import type { WiredIn } from "./modules.ts";
  import ModuleTypeSelect from "./ModuleTypeSelect.svelte";
  import RemoveButton from "./RemoveButton.svelte";
  import { stringCss } from "./scene.ts";
  import ValueRow from "./ValueRow.svelte";

  let {
    string,
    position,
    made,
    warnings,
    refused,
    moduleTypes,
    devices,
    inputs,
    onchange,
    onremove,
  }: {
    string: Readonly<StringDraft>;
    /** Its position in the layout, which picks its colour. */
    position: number;
    /** The modules the scene wires into it. */
    made: WiredIn;
    /** Where it leaves its inverter's limits: the cold voltage and its MPPT input's window. */
    warnings: readonly string[];
    /** Why the last save was refused for it, if it was. */
    refused: string | undefined;
    moduleTypes: readonly ModuleType[];
    /** The inverters it may be wired to. */
    devices: readonly Device[];
    /** How many MPPT inputs its inverter has, where its profile lists them. */
    inputs: number | undefined;
    onchange: (string: Readonly<StringDraft>) => void;
    onremove: () => void;
  } = $props();

  const named = $derived(devices.some(({ id }) => id === string.device));

  /** The inverter by name; by number only while the device list does not hold it. */
  const device = $derived(
    named
      ? choices(
          m.field_device(),
          devices.map(({ name }) => name),
        )
      : amount(m.field_device(), 1, 999),
  );

  // The inputs its inverter has (ADR 9); 16 where its profile lists none.
  const input = $derived(amount(m.field_input(), 1, inputs ?? 16));
  const loss = amount(m.field_loss(), 0, 50, 0.1);
</script>

<Item.Group class="gap-0 divide-y divide-border/60">
  <Item.Root class="rounded-none border-0">
    <Item.Media>
      <span class="size-3 rounded-sm" style:background={stringCss(position)}></span>
    </Item.Media>
    <Item.Content>
      <label class="flex flex-col gap-1.5 text-sm text-muted-foreground">
        {m.field_name()}
        <Input
          value={string.name}
          oninput={(event) => {
            onchange({ ...string, name: event.currentTarget.value });
          }}
        />
      </label>
    </Item.Content>
  </Item.Root>
  <ModuleTypeSelect
    value={string.moduleType}
    {moduleTypes}
    onchange={(moduleType) => {
      onchange({ ...string, moduleType });
    }}
  />
  <ValueRow
    edit={device}
    value={named ? devices.findIndex(({ id }) => id === string.device) : string.device}
    onchange={(value) => {
      onchange({ ...string, device: named ? (devices[value]?.id ?? string.device) : value });
    }}
  />
  <ValueRow
    edit={input}
    value={string.input}
    onchange={(value) => {
      onchange({ ...string, input: value });
    }}
  />
  <ValueRow
    edit={loss}
    value={string.loss}
    onchange={(value) => {
      onchange({ ...string, loss: value });
    }}
  />
  <Item.Root class="rounded-none border-0">
    <Item.Content>
      <Item.Description>{m.builder_string_modules(made)}</Item.Description>
      <p class="text-sm text-muted-foreground">{m.builder_string_hint()}</p>
      {#if refused !== undefined}
        <p role="alert" class="text-sm text-destructive">{refused}</p>
      {/if}
      {#each warnings as warning (warning)}
        <p role="status" class="text-sm text-warning">{warning}</p>
      {/each}
    </Item.Content>
  </Item.Root>
</Item.Group>
<RemoveButton {onremove} />

<!--
  A device as the admin adds it on a connection or changes it: its name, connection and address.
  The profile is chosen once, on adding (ADR 6). A new connection, such as EVCC's broker, can be
  made here on the way.
-->
<script lang="ts">
  import Plus from "@lucide/svelte/icons/plus";
  import type { Connection, Core, Device, Problem } from "../api/core";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import * as Select from "#lib/components/ui/select/index.js";
  import ValueRow from "../builder/ValueRow.svelte";
  import { m } from "../paraglide/messages.js";
  import { FIELD } from "../setup/fields.ts";
  import ProfilePicker from "../setup/ProfilePicker.svelte";
  import Refusal from "../setup/Refusal.svelte";
  import ConnectionForm from "./ConnectionForm.svelte";

  let {
    core,
    connections,
    device,
    onsaved,
  }: {
    core: Core;
    connections: readonly Connection[];
    /** The device to change; a new one when absent. */
    device?: Device;
    onsaved: (device: Device) => void;
  } = $props();

  // The form edits its own copy of the device.
  // svelte-ignore state_referenced_locally
  const fields = $state({
    name: device?.name ?? "",
    connection: device?.connection ?? connections[0]?.id,
    profile: device?.profile ?? "",
    unit: device?.unit ?? 1,
  });

  /** Connections made on this form, until the page lists them. */
  let made = $state.raw<readonly Connection[]>([]);

  let making = $state(false);

  let refused = $state.raw<Problem>();

  const choices = $derived([
    ...connections,
    ...made.filter((c) => !connections.some((known) => known.id === c.id)),
  ]);

  const id = $props.id();

  const chosen = $derived.by(() => {
    const at = choices.find((c) => c.id === fields.connection);

    return at && `${at.name} · ${at.transport}`;
  });

  const broker = $derived(choices.find((c) => c.id === fields.connection)?.transport === "mqtt");

  // A Modbus unit id, or a broker profile's index, such as an EVCC loadpoint's from 1.
  const unit = $derived({
    kind: "number" as const,
    name: broker ? m.settings_device_loadpoint() : m.settings_device_unit(),
    unit: "",
    min: broker ? 1 : 0,
    max: 247,
    step: 1,
  });

  const ready = $derived(
    fields.name.trim() !== "" && fields.profile !== "" && fields.connection !== undefined,
  );

  function adopt(connection: Connection): void {
    made = [...made, connection];
    fields.connection = connection.id;
    making = false;
  }

  async function save(): Promise<void> {
    const { connection } = fields;

    if (connection === undefined) return;

    // The writes switch is Settings › Writes'; a change here keeps it.
    const draft = {
      connection,
      name: fields.name.trim(),
      profile: fields.profile,
      unit: fields.unit,
      writes: device?.writes ?? false,
    };

    const answer =
      device === undefined ? await core.addDevice(draft) : await core.changeDevice(device.id, draft);

    refused = "problem" in answer ? answer : undefined;

    if (!("problem" in answer)) onsaved(answer);
  }
</script>

<div class="flex flex-col gap-3 p-4">
  {#if device === undefined}
    <div class={FIELD}>
      <span>{m.devices_profile()}</span>
      <ProfilePicker
        {core}
        value={fields.profile}
        label={m.devices_profile()}
        onpick={(id) => {
          fields.profile = id;
        }}
      />
    </div>
  {:else}
    <div class={FIELD}>
      <span>{m.devices_profile()}</span>
      <span class="text-[15px]">{device.profile}</span>
      <span class="text-xs text-muted-foreground">{m.settings_device_profile_fixed()}</span>
    </div>
  {/if}
  <div class={FIELD}>
    <label for="{id}-connection">{m.settings_device_connection()}</label>
    <Select.Root
      type="single"
      bind:value={
        () => String(fields.connection),
        (next) => {
          fields.connection = Number(next);
        }
      }
    >
      <Select.Trigger id="{id}-connection" class="w-full">
        <span class="truncate">{chosen ?? ""}</span>
      </Select.Trigger>
      <Select.Content>
        <Select.Group>
          {#each choices as option (option.id)}
            <Select.Item value={String(option.id)} label="{option.name} · {option.transport}" />
          {/each}
        </Select.Group>
      </Select.Content>
    </Select.Root>
  </div>
  {#if device === undefined}
    {#if making}
      <div class="rounded-md border border-border/60">
        <ConnectionForm {core} onsaved={adopt} />
      </div>
    {:else}
      <Button
        variant="outline"
        class="self-start"
        onclick={() => {
          making = true;
        }}
      >
        <Plus data-icon="inline-start" />
        {m.settings_connection_add()}
      </Button>
    {/if}
  {/if}
  <div class="overflow-hidden rounded-md border border-border/60">
    <ValueRow
      edit={unit}
      value={fields.unit}
      onchange={(next) => {
        fields.unit = next;
      }}
    />
  </div>
  <label class={FIELD}>
    {m.devices_device_name()}
    <Input required autocomplete="off" bind:value={fields.name} />
  </label>
  <Refusal {refused} />
  <Button class="w-full sm:w-auto sm:self-end" disabled={!ready} onclick={save}>
    {device === undefined ? m.settings_device_add() : m.settings_save()}
  </Button>
</div>

<!--
  A connection as the admin adds or changes it: where it reaches, a broker's topic root and
  publisher, and its credentials, which show only whether they are set (ADR 7).
-->
<script lang="ts">
  import type { Connection, ConnectionDraft, Core, Problem } from "../api/core";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import * as Select from "#lib/components/ui/select/index.js";
  import ValueRow from "../builder/ValueRow.svelte";
  import { m } from "../paraglide/messages.js";
  import { FIELD } from "../setup/fields.ts";
  import Refusal from "../setup/Refusal.svelte";
  import { portOf, secretsOf, TRANSPORTS } from "./connection-draft.ts";
  import SecretField from "./SecretField.svelte";
  import ToggleRow from "./ToggleRow.svelte";

  let {
    core,
    connection,
    onsaved,
  }: {
    core: Core;
    /** The connection to change; a new one when absent. */
    connection?: Connection;
    onsaved: (connection: Connection) => void;
  } = $props();

  /** Each credential's change: a value sets it, null clears it, undefined keeps it. */
  const changes: Record<string, string | null | undefined> = {};

  // The form edits its own copy; the connection it started from stays as the core listed it.
  // svelte-ignore state_referenced_locally
  const fields = $state({
    name: connection?.name ?? "",
    transport: connection?.transport ?? "modbus-tcp",
    host: connection?.host ?? "",
    port: connection?.port ?? portOf("modbus-tcp"),
    topicRoot: connection?.topicRoot ?? "",
    publish: connection?.publish !== undefined && connection.publish !== null,
    discovery: connection?.publish?.discovery ?? false,
    secrets: changes,
  });

  /** The draft the core takes: a broker's topic root and publisher only on a broker, changed secrets only. */
  function draft(): ConnectionDraft {
    const { name, transport, host, port } = fields;

    const changed = Object.entries(fields.secrets).flatMap(([key, value]) =>
      value !== undefined && secretsOf(transport).some((secret) => secret === key) ? [[key, value] as const] : [],
    );

    let made: ConnectionDraft = { name: name.trim(), transport, host: host.trim(), port };

    if (transport === "mqtt") made = { ...made, topicRoot: fields.topicRoot.trim() };

    if (transport === "mqtt" && fields.publish)
      made = { ...made, publish: { discovery: fields.discovery } };

    if (changed.length > 0) made = { ...made, secrets: Object.fromEntries(changed) };

    return made;
  }

  let refused = $state.raw<Problem>();

  let saving = $state(false);

  const PORT = {
    kind: "number" as const,
    name: m.devices_endpoint_port(),
    unit: "",
    min: 1,
    max: 65_535,
    step: 1,
  };

  const LABELS = {
    username: m.settings_connection_username,
    password: m.settings_connection_password,
  } as const;

  const ready = $derived(
    fields.name.trim() !== "" &&
      fields.host.trim() !== "" &&
      (fields.transport !== "mqtt" || fields.topicRoot.trim() !== ""),
  );

  const id = $props.id();

  function pick(value: string): void {
    const next = TRANSPORTS.find(([t]) => t === value)?.[0];

    if (next === undefined) return;

    // A port still at the old transport's usual one moves to the new one's.
    if (fields.port === portOf(fields.transport)) fields.port = portOf(next);

    fields.transport = next;
  }

  async function save(): Promise<void> {
    saving = true;

    const answer =
      connection === undefined
        ? await core.addConnection(draft())
        : await core.changeConnection(connection.id, draft());

    saving = false;
    refused = "problem" in answer ? answer : undefined;

    if (!("problem" in answer)) onsaved(answer);
  }
</script>

<div class="flex flex-col gap-3 p-4">
  <label class={FIELD}>
    {m.settings_connection_name()}
    <Input required autocomplete="off" bind:value={fields.name} />
  </label>
  <div class={FIELD}>
    <label for="{id}-transport">{m.devices_endpoint_transport()}</label>
    <Select.Root type="single" bind:value={() => fields.transport, pick}>
      <Select.Trigger id="{id}-transport" class="w-full">{fields.transport}</Select.Trigger>
      <Select.Content>
        <Select.Group>
          {#each TRANSPORTS as [option] (option)}
            <Select.Item value={option} label={option} />
          {/each}
        </Select.Group>
      </Select.Content>
    </Select.Root>
  </div>
  <label class={FIELD}>
    {m.devices_endpoint_host()}
    <Input required autocomplete="off" placeholder="192.168.1.40" bind:value={fields.host} />
  </label>
  <div class="overflow-hidden rounded-md border border-border/60">
    <ValueRow
      edit={PORT}
      value={fields.port}
      onchange={(next) => {
        fields.port = next;
      }}
    />
  </div>
  {#if fields.transport === "mqtt"}
    <label class={FIELD}>
      {m.settings_connection_topic_root()}
      <Input required autocomplete="off" placeholder="evcc" bind:value={fields.topicRoot} />
    </label>
    <div class="overflow-hidden rounded-md border border-border/60">
      <ToggleRow
        label={m.settings_connection_publish()}
        hint={m.settings_connection_publish_hint()}
        checked={fields.publish}
        onchange={(on) => {
          fields.publish = on;
        }}
      />
      {#if fields.publish}
        <ToggleRow
          label={m.settings_connection_discovery()}
          checked={fields.discovery}
          onchange={(on) => {
            fields.discovery = on;
          }}
        />
      {/if}
    </div>
  {/if}
  {#each secretsOf(fields.transport) as secret (secret)}
    <SecretField
      label={LABELS[secret]()}
      set={connection?.secrets.includes(secret) ?? false}
      hidden={secret === "password"}
      bind:value={fields.secrets[secret]}
    />
  {/each}
  <Refusal {refused} />
  <Button class="w-full sm:w-auto sm:self-end" disabled={!ready || saving} onclick={save}>
    {connection === undefined ? m.settings_connection_add() : m.settings_save()}
  </Button>
</div>

<!-- A secondary way in: an endpoint the scan does not probe, such as an RTU gateway, entered by hand. -->
<script lang="ts">
  import TextField from "../components/text-field.svelte";
  import Plus from "@lucide/svelte/icons/plus";
  import type { Found } from "../api/core.ts";
  import type { Endpoint } from "./choices.ts";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as ToggleGroup from "#lib/components/ui/toggle-group/index.js";
  import ValueRow from "../builder/ValueRow.svelte";
  import { m } from "../paraglide/messages.js";
  import { TRANSPORTS } from "./choices.ts";
  import { FIELD } from "./fields.ts";

  let { onadd }: { onadd: (endpoint: Endpoint) => void } = $props();

  const uid = $props.id();

  const PORT = {
    kind: "number" as const,
    name: m.devices_endpoint_port(),
    unit: "",
    min: 1,
    max: 65_535,
    step: 1,
  };

  let open = $state(false);

  let host = $state("");

  let port = $state(502);

  let transport = $state<Found["transport"]>("modbus-tcp");

  function pick(next: string): void {
    const chosen = TRANSPORTS.find((t) => t === next);

    if (chosen !== undefined) transport = chosen;
  }

  function add(): void {
    onadd({ host: host.trim(), port, transport, devices: [] });
    open = false;
    host = "";
  }
</script>

{#if open}
  <div class="flex flex-col gap-3 rounded-md border border-border/60 p-3">
    <p class="text-sm text-muted-foreground">{m.devices_endpoint()}</p>
    <TextField
      label={m.devices_endpoint_host()}
      required autocomplete="off" placeholder="192.168.1.40" bind:value={host}
    />
    <div class="overflow-hidden rounded-md border border-border/60">
      <ValueRow
        edit={PORT}
        value={port}
        onchange={(next) => {
          port = next;
        }}
      />
    </div>
    <div class={FIELD}>
      <span id="{uid}-transport">{m.devices_endpoint_transport()}</span>
      <ToggleGroup.Root
        type="single"
        spacing={1}
        bind:value={() => transport, pick}
        aria-labelledby="{uid}-transport"
        class="grid w-full grid-cols-3 rounded-md p-0.5 ring-1 ring-border/60"
      >
        {#each TRANSPORTS as option (option)}
          <ToggleGroup.Item value={option} class="px-1 text-xs">{option}</ToggleGroup.Item>
        {/each}
      </ToggleGroup.Root>
    </div>
    <div class="flex flex-wrap gap-2">
      <Button variant="outline" disabled={host.trim() === ""} onclick={add}>
        {m.devices_endpoint_add()}
      </Button>
      <Button
        variant="ghost"
        onclick={() => {
          open = false;
        }}>{m.access_cancel()}</Button
      >
    </div>
  </div>
{:else}
  <Button
    variant="outline"
    class="self-start"
    onclick={() => {
      open = true;
    }}
  >
    <Plus data-icon="inline-start" />
    {m.devices_endpoint_open()}
  </Button>
{/if}

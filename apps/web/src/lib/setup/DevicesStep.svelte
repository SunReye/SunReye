<!--
  Setup's devices step: a scan, then its devices as rows. Recognised devices come first and chosen;
  hosts no profile recognises wait folded away; an endpoint the scan misses is entered by hand.
-->
<script lang="ts">
  import type { Connection, Core, Device, Problem } from "../api/core.ts";
  import { Button } from "#lib/components/ui/button/index.js";
  import { m } from "../paraglide/messages.js";
  import { manual, scanned, type Choice, type Endpoint } from "./choices.ts";
  import EndpointForm from "./EndpointForm.svelte";
  import FoundRow from "./FoundRow.svelte";
  import ManualRow from "./ManualRow.svelte";
  import OtherHosts from "./OtherHosts.svelte";
  import Refusal from "./Refusal.svelte";
  import ScanPanel from "./ScanPanel.svelte";

  let {
    core,
    known = { connections: [], devices: [] },
    ondone,
  }: {
    core: Core;
    /** What the core already has, after setup: a scan leaves its devices out and reuses its connections. */
    known?: { readonly connections: readonly Connection[]; readonly devices: readonly Device[] };
    ondone: (devices: readonly Device[]) => void;
  } = $props();

  let choices = $state<Choice[]>([]);

  let refused = $state.raw<Problem>();

  // The keys of the devices the admin entered at an endpoint of their own.
  let entries = $state<readonly string[]>([]);

  // The connections the core already has and those an earlier, partly refused add created, so
  // adding again does not create one twice.
  // svelte-ignore state_referenced_locally
  const connections = new Map<string, Connection>(
    known.connections.map((connection) => [`${connection.host}:${connection.port}`, connection]),
  );

  const added = new Map<string, Device>();

  const recognised = $derived(choices.filter((c) => !c.manual));

  const entered = $derived(choices.filter((c) => entries.includes(c.key)));

  const others = $derived(choices.filter((c) => c.manual && !entries.includes(c.key)));

  const chosen = $derived(choices.filter((choice) => choice.chosen).length);

  /** How many devices the last scan found that the core already reads. */
  let skipped = $state(0);

  /** The new scan's choices; an endpoint entered by hand stays as entered. */
  function show(endpoints: Parameters<typeof scanned>[0]): void {
    const fresh = scanned(endpoints).filter((choice) => !entries.includes(choice.key));

    skipped = fresh.filter((choice) => registered(choice)).length;
    choices = [
      ...choices.filter((choice) => entries.includes(choice.key)),
      ...fresh.filter((choice) => !registered(choice)),
    ];
  }

  /** Whether the core already reads the device a scan proposes. */
  function registered(choice: Choice): boolean {
    const { found, unit } = choice;
    const connection = connections.get(`${found.host}:${found.port}`);

    return (
      !choice.manual &&
      connection !== undefined &&
      known.devices.some((device) => device.connection === connection.id && device.unit === unit)
    );
  }

  /** Lists the endpoint the admin entered, chosen, for its device to be entered by hand. */
  function enter(endpoint: Endpoint): void {
    const choice = manual(endpoint, true);

    entries = [...entries.filter((key) => key !== choice.key), choice.key];
    choices = [...choices.filter((c) => c.key !== choice.key), choice];
  }

  /** Adds each chosen endpoint as a connection, then its chosen devices behind it. */
  async function addEndpoint(
    endpoint: Endpoint,
    picked: readonly Choice[],
  ): Promise<readonly (Device | Problem)[]> {
    const { host, port, transport } = endpoint;
    const at = `${host}:${port}`;

    const connection =
      connections.get(at) ?? (await core.addConnection({ name: host, host, port, transport }));

    if ("problem" in connection) return [connection];

    connections.set(at, connection);

    return Promise.all(
      picked
        .values()
        .filter((choice) => choice.found === endpoint)
        .map(async (choice) => {
          const before = added.get(choice.key);

          if (before !== undefined) return before;

          const { profile, variant, unit, name } = choice;

          const device = await core.addDevice({
            connection: connection.id,
            name,
            profile,
            ...(variant !== undefined && { variant }),
            unit,
          });

          if (!("problem" in device)) added.set(choice.key, device);

          return device;
        })
        .toArray(),
    );
  }

  /** Adds every chosen device; the first refusal stands. */
  async function add(): Promise<void> {
    const picked = choices.filter((choice) => choice.chosen);
    const endpoints = [...new Set(picked.map((choice) => choice.found))];
    const outcomes = (await Promise.all(endpoints.map((e) => addEndpoint(e, picked)))).flat();

    refused = outcomes.find((outcome) => "problem" in outcome);

    if (refused === undefined)
      ondone(outcomes.flatMap((outcome) => ("problem" in outcome ? [] : [outcome])));
  }
</script>

{#snippet heading(text: string)}
  <h3 class="px-4 pt-4 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
    {text}
  </h3>
{/snippet}

<div class="flex flex-col gap-4 p-4">
  <p class="text-sm text-muted-foreground">{m.devices_hint()}</p>
  <ScanPanel {core} onscanned={show} />
  {#if skipped > 0}
    <p role="status" class="text-sm text-muted-foreground">
      {m.devices_known({ count: skipped })}
    </p>
  {/if}
</div>
{#if recognised.length > 0}
  {@render heading(m.devices_found())}
  <ul class="divide-y divide-border/60 border-y border-border/60">
    {#each recognised as choice (choice.key)}<FoundRow {choice} />{/each}
  </ul>
{/if}
{#if entered.length > 0}
  {@render heading(m.devices_entered())}
  <ul class="divide-y divide-border/60 border-y border-border/60">
    {#each entered as choice (choice.key)}
      <ManualRow {core} {choice} note={m.devices_entered()} />
    {/each}
  </ul>
{/if}
{#if others.length > 0}
  <OtherHosts count={others.length}>
    {#each others as choice (choice.key)}
      <ManualRow {core} {choice} note={m.devices_unrecognised()} />
    {/each}
  </OtherHosts>
{/if}
<div class="flex flex-col gap-3 border-t border-border/60 p-4">
  <EndpointForm onadd={enter} />
  <Refusal {refused} />
  <Button class="w-full sm:w-auto sm:self-end" disabled={chosen === 0} onclick={add}>
    {m.devices_add()}
  </Button>
</div>

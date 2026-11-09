<script lang="ts">
  import type { Core, Device, Found, Problem } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import Refusal from "./Refusal.svelte";

  let { core, ondone }: { core: Core; ondone: (devices: readonly Device[]) => void } = $props();

  /** A device the scan proposed, as the admin confirms and names it. */
  interface Choice {
    readonly found: Found;
    readonly profile: string;
    readonly unit: number;
    chosen: boolean;
    name: string;
  }

  let subnet = $state("");

  let scanning = $state(false);

  let found = $state.raw<readonly Found[]>();

  let choices = $state<Choice[]>([]);

  let refused = $state.raw<Problem>();

  async function scan(): Promise<void> {
    scanning = true;
    const report = await core.scan(subnet === "" ? undefined : subnet);

    scanning = false;
    refused = "problem" in report ? report : undefined;
    found = "problem" in report ? undefined : report.endpoints;
    choices = (found ?? []).flatMap((endpoint) =>
      endpoint.devices.map(({ profile, unit }) => ({
        found: endpoint,
        profile,
        unit,
        chosen: false,
        name: profile,
      })),
    );
  }

  /** Adds each chosen endpoint as a connection, then its chosen devices behind it. */
  async function addEndpoint(
    endpoint: Found,
    chosen: readonly Choice[],
  ): Promise<readonly (Device | Problem)[]> {
    const { host, port, transport } = endpoint;
    const connection = await core.addConnection({ name: host, host, port, transport });

    if ("problem" in connection) return [connection];

    return Promise.all(
      chosen
        .values()
        .filter((choice) => choice.found === endpoint)
        .map(({ profile, unit, name }) =>
          core.addDevice({ connection: connection.id, name, profile, unit }),
        )
        .toArray(),
    );
  }

  /** Adds every chosen device; the first refusal stands. */
  async function add(): Promise<void> {
    const chosen = choices.filter((choice) => choice.chosen);
    const endpoints = [...new Set(chosen.map((choice) => choice.found))];
    const added = (await Promise.all(endpoints.map((e) => addEndpoint(e, chosen)))).flat();

    refused = added.find((outcome) => "problem" in outcome);

    if (refused === undefined)
      ondone(added.flatMap((outcome) => ("problem" in outcome ? [] : [outcome])));
  }
</script>

<label>
  {m.devices_subnet()}
  <input placeholder="192.168.1.0/24" bind:value={subnet} />
</label>
<button type="button" disabled={scanning} onclick={scan}>{m.devices_scan()}</button>
{#if scanning}
  <p role="status">{m.devices_scanning()}</p>
{/if}
{#if found !== undefined}
  {#if found.length === 0}
    <p>{m.devices_none()}</p>
  {/if}
  <ul>
    {#each choices as choice (`${choice.found.host}:${choice.found.port}/${choice.profile}/${choice.unit}`)}
      <li>
        <label>
          <input type="checkbox" bind:checked={choice.chosen} />
          {m.devices_confirm({
            profile: choice.profile,
            host: choice.found.host,
            port: choice.found.port,
            unit: choice.unit,
          })}
        </label>
        <label>
          {m.devices_name({ profile: choice.profile })}
          <input required bind:value={choice.name} />
        </label>
      </li>
    {/each}
    {#each found.filter((endpoint) => endpoint.devices.length === 0) as endpoint (`${endpoint.host}:${endpoint.port}`)}
      <li>{m.devices_unknown({ host: endpoint.host, port: endpoint.port })}</li>
    {/each}
  </ul>
  <button type="button" disabled={!choices.some((choice) => choice.chosen)} onclick={add}>
    {m.devices_add()}
  </button>
{/if}
<Refusal {refused} />

<script lang="ts">
  import type { Core, Device, Found, Problem } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import Refusal from "./Refusal.svelte";

  let { core, ondone }: { core: Core; ondone: (devices: readonly Device[]) => void } = $props();

  /**
   * A device the scan proposed, as the admin confirms and names it; or, at an endpoint no profile
   * recognised, one the admin enters by hand.
   */
  interface Choice {
    /** Fixed while the admin types a manual entry's profile and unit. */
    readonly key: string;
    readonly found: Found;
    readonly manual: boolean;
    profile: string;
    unit: number;
    chosen: boolean;
    name: string;
  }

  /** Where a manual entry starts: the usual Modbus unit. */
  const UNIT = 1;

  let subnet = $state("");

  let scanning = $state(false);

  let found = $state.raw<readonly Found[]>();

  let choices = $state<Choice[]>([]);

  let refused = $state.raw<Problem>();

  // What an earlier, partly refused add created, so adding again does not create it twice.
  const connections = new Map<string, number>();
  const added = new Map<string, Device>();

  async function scan(): Promise<void> {
    scanning = true;
    const report = await core.scan(subnet === "" ? undefined : subnet);

    scanning = false;
    refused = "problem" in report ? report : undefined;
    found = "problem" in report ? undefined : report.endpoints;

    choices = (found ?? []).flatMap((endpoint): Choice[] => {
      const at = `${endpoint.host}:${endpoint.port}`;

      if (endpoint.devices.length === 0) {
        const manual = { profile: "", unit: UNIT, name: "" };

        return [{ key: `${at}/manual`, found: endpoint, manual: true, chosen: false, ...manual }];
      }

      return endpoint.devices.map(({ profile, unit }) => ({
        key: `${at}/${profile}/${unit}`,
        found: endpoint,
        manual: false,
        profile,
        unit,
        chosen: false,
        name: profile,
      }));
    });
  }

  /** Adds each chosen endpoint as a connection, then its chosen devices behind it. */
  async function addEndpoint(
    endpoint: Found,
    chosen: readonly Choice[],
  ): Promise<readonly (Device | Problem)[]> {
    const { host, port, transport } = endpoint;
    const connection =
      connections.get(`${host}:${port}`) ??
      (await core.addConnection({ name: host, host, port, transport }));

    if (typeof connection !== "number" && "problem" in connection) return [connection];

    const id = typeof connection === "number" ? connection : connection.id;

    connections.set(`${host}:${port}`, id);

    return Promise.all(
      chosen
        .values()
        .filter((choice) => choice.found === endpoint)
        .map(async (choice) => {
          const before = added.get(choice.key);

          if (before !== undefined) return before;

          const { profile, unit, name } = choice;
          const device = await core.addDevice({ connection: id, name, profile, unit });

          if (!("problem" in device)) added.set(choice.key, device);

          return device;
        })
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
    {#each choices as choice (choice.key)}
      {@const at = { host: choice.found.host, port: choice.found.port }}
      <li>
        {#if choice.manual}
          <p>{m.devices_unknown(at)}</p>
          <label>
            <input type="checkbox" bind:checked={choice.chosen} />
            {m.devices_manual(at)}
          </label>
          <label>
            {m.devices_manual_profile(at)}
            <input required bind:value={choice.profile} />
          </label>
          <label>
            {m.devices_manual_unit(at)}
            <input type="number" min="0" required bind:value={choice.unit} />
          </label>
          <label>
            {m.devices_manual_name(at)}
            <input required bind:value={choice.name} />
          </label>
        {:else}
          <label>
            <input type="checkbox" bind:checked={choice.chosen} />
            {m.devices_confirm({ ...at, profile: choice.profile, unit: choice.unit })}
          </label>
          <label>
            {m.devices_name({ profile: choice.profile })}
            <input required bind:value={choice.name} />
          </label>
        {/if}
      </li>
    {/each}
  </ul>
  <button type="button" disabled={!choices.some((choice) => choice.chosen)} onclick={add}>
    {m.devices_add()}
  </button>
{/if}
<Refusal {refused} />

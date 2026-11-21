<!--
  Settings › Devices: the list, and a level to add a device, change or remove one, or review the
  measuring points after a change (ADR 14). Each level is a hash route (ADR 21): `add`, `topology`,
  or a device's id.
-->
<script lang="ts">
  import DrillCard from "../components/drill-in/drill-card.svelte";
  import { onMount } from "svelte";
  import type { Connection, Core, Device, Listing, Problem } from "../api/core";
  import DrillPush from "../components/drill-in/drill-push.svelte";
  import LoadingRows from "../components/loading-rows.svelte";
  import Refusal from "../setup/Refusal.svelte";
  import DevicesLevel from "./DevicesLevel.svelte";

  let {
    core,
    level,
    onlevel,
  }: {
    core: Core;
    /** The open level, from the hash route; null on the list. */
    level: string | null;
    onlevel: (id: string | null) => void;
  } = $props();

  let listed = $state.raw<{
    devices: readonly Device[];
    connections: readonly Connection[];
    /** The profiles served, which name what each device is read as; none when they do not load. */
    profiles: readonly Listing[];
  }>();

  let refused = $state.raw<Problem>();

  let changed = $state(false);

  /** Each device as last listed, so a removed one's level still shows while it slides away. */
  const seen = new Map<string, Device>();

  /** The device a level's key names; none on another level, or once it is removed. */
  function named(key: string | null): Device | undefined {
    const found = listed?.devices.find((d) => String(d.id) === key);

    if (found !== undefined) seen.set(String(found.id), found);

    return found;
  }

  /** The list's key; a level the route names but nothing holds shows the list. */
  const LIST = "list";

  const at = $derived(
    level === "add" || level === "topology" || named(level) !== undefined ? (level ?? LIST) : LIST,
  );

  async function load(): Promise<void> {
    const [devices, connections, profiles] = await Promise.all([
      core.devices(),
      core.connections(),
      core.profiles(),
    ]);

    if ("problem" in devices) {
      refused = devices;

      return;
    }

    listed = {
      devices,
      connections: "problem" in connections ? [] : connections,
      profiles: "problem" in profiles ? [] : profiles,
    };
  }

  onMount(() => {
    void load();
  });

  /** Back on the list after a change, which offers the measuring points' review. */
  async function after(): Promise<void> {
    await load();
    changed = true;
    onlevel(null);
  }

  const back = () => {
    onlevel(null);
  };
</script>

{#if listed === undefined}
  <DrillCard>
    {#if refused}<div class="p-4"><Refusal {refused} /></div>{:else}<LoadingRows />{/if}
  </DrillCard>
{:else}
  {@const known = listed}
  <!-- A level slides over the list, which shifts aside. -->
  <DrillPush {at} depth={at === LIST ? 0 : 1} up={at === LIST ? null : LIST} onback={back}>
    {#snippet children(key)}
      <DevicesLevel
        {core}
        {key}
        {known}
        device={named(key) ?? seen.get(key)}
        {changed}
        {onlevel}
        onchanged={after}
        onreviewed={() => {
          changed = false;
          back();
        }}
      />
    {/snippet}
  </DrillPush>
{/if}

<!--
  Settings › Connections: where the core reaches its devices, each broker's state, and a level to
  add or change one. Each level is a hash route (ADR 21): `add`, or a connection's id.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import type { Connection, Core, Problem } from "../api/core";
  import DrillPush from "../components/drill-in/drill-push.svelte";
  import LoadingRows from "../components/loading-rows.svelte";
  import ConnectionsLevel from "./ConnectionsLevel.svelte";

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

  let listed = $state.raw<readonly Connection[] | Problem>();

  /** Each connection as last listed, so a removed one's level still shows while it slides away. */
  const seen = new Map<string, Connection>();

  /** The connection a level's key names; none on another level, or once it is removed. */
  function named(key: string | null): Connection | undefined {
    const list = listed === undefined || "problem" in listed ? [] : listed;
    const found = list.find((c) => String(c.id) === key);

    if (found !== undefined) seen.set(String(found.id), found);

    return found;
  }

  /** The list's key; a level the route names but nothing holds shows the list. */
  const LIST = "list";

  const at = $derived(level === "add" || named(level) !== undefined ? (level ?? LIST) : LIST);

  async function load(): Promise<void> {
    listed = await core.connections();
  }

  onMount(() => {
    void load();
  });

  async function after(): Promise<void> {
    await load();
    onlevel(null);
  }

  async function remove(id: number): Promise<Problem | undefined> {
    const problem = await core.removeConnection(id);

    if (problem === undefined) await after();

    return problem;
  }

  const back = () => {
    onlevel(null);
  };
</script>

{#if listed === undefined}
  <div class="drill-card"><LoadingRows /></div>
{:else}
  {@const known = listed}
  <!-- A level slides over the list, which shifts aside. -->
  <DrillPush {at} depth={at === LIST ? 0 : 1} up={at === LIST ? null : LIST} onback={back}>
    {#snippet children(key)}
      <ConnectionsLevel
        {core}
        {key}
        listed={known}
        connection={named(key) ?? seen.get(key)}
        {onlevel}
        onsaved={after}
        onremove={remove}
      />
    {/snippet}
  </DrillPush>
{/if}

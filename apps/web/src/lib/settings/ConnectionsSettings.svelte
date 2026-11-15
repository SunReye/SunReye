<!--
  Settings › Connections: where the core reaches its devices, each broker's state, and a level to
  add or change one. Each level is a hash route (ADR 21): `add`, or a connection's id.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import type { Connection, Core, Problem } from "../api/core";
  import LoadingRows from "../components/loading-rows.svelte";
  import { m } from "../paraglide/messages.js";
  import ConnectionForm from "./ConnectionForm.svelte";
  import ConnectionList from "./ConnectionList.svelte";
  import Level from "./Level.svelte";
  import RemoveConfirm from "./RemoveConfirm.svelte";

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

  /** The connection the level names; none on another level, or once it is removed. */
  const open = $derived.by(() => {
    const list = listed === undefined || "problem" in listed ? [] : listed;

    return list.find((c) => String(c.id) === level);
  });

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
{:else if level === "add"}
  <Level back={m.settings_connections()} title={m.settings_connection_add()} onback={back}>
    <ConnectionForm {core} onsaved={after} />
  </Level>
{:else if open === undefined}
  <div class="drill-card">
    <ConnectionList
      answer={listed}
      onopen={(id) => {
        onlevel(String(id));
      }}
      onadd={() => {
        onlevel("add");
      }}
    />
  </div>
{:else}
  <Level back={m.settings_connections()} title={open.name} onback={back}>
    <ConnectionForm {core} connection={open} onsaved={after} />
    <RemoveConfirm
      ask={m.settings_connection_remove()}
      note={m.settings_connection_remove_note()}
      onremove={() => remove(open.id)}
    />
  </Level>
{/if}

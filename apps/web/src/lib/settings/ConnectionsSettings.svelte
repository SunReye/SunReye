<!-- Settings › Connections: where the core reaches its devices, each broker's state, and a level to add or change one. -->
<script lang="ts">
  import { onMount } from "svelte";
  import type { Connection, Core, Problem } from "../api/core";
  import LoadingRows from "../components/loading-rows.svelte";
  import { m } from "../paraglide/messages.js";
  import ConnectionForm from "./ConnectionForm.svelte";
  import ConnectionList from "./ConnectionList.svelte";
  import Level from "./Level.svelte";
  import RemoveConfirm from "./RemoveConfirm.svelte";

  let { core }: { core: Core } = $props();

  type Shown =
    | { readonly kind: "list" }
    | { readonly kind: "add" }
    | { readonly kind: "connection"; readonly id: number };

  let shown = $state.raw<Shown>({ kind: "list" });

  let listed = $state.raw<readonly Connection[] | Problem>();

  const open = $derived.by(() => {
    const at = shown;

    const list = listed === undefined || "problem" in listed ? [] : listed;

    return at.kind === "connection" ? list.find((c) => c.id === at.id) : undefined;
  });

  async function load(): Promise<void> {
    listed = await core.connections();
  }

  onMount(() => {
    void load();
  });

  async function after(): Promise<void> {
    await load();
    shown = { kind: "list" };
  }

  async function remove(id: number): Promise<Problem | undefined> {
    const problem = await core.removeConnection(id);

    if (problem === undefined) await after();

    return problem;
  }

  const back = () => {
    shown = { kind: "list" };
  };
</script>

{#if listed === undefined}
  <div class="drill-card"><LoadingRows /></div>
{:else if shown.kind === "add"}
  <Level back={m.settings_connections()} title={m.settings_connection_add()} onback={back}>
    <ConnectionForm {core} onsaved={after} />
  </Level>
{:else if open === undefined}
  <div class="drill-card">
    <ConnectionList
      answer={listed}
      onopen={(id) => {
        shown = { kind: "connection", id };
      }}
      onadd={() => {
        shown = { kind: "add" };
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

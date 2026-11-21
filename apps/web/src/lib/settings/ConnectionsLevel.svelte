<!-- One level of Settings › Connections by its key: the list, adding a connection, or one connection. -->
<script lang="ts">
  import DrillCard from "../components/drill-in/drill-card.svelte";
  import type { Connection, Core, Problem } from "../api/core";
  import { m } from "../paraglide/messages.js";
  import ConnectionForm from "./ConnectionForm.svelte";
  import ConnectionList from "./ConnectionList.svelte";
  import Level from "./Level.svelte";
  import type { IdKey } from "./level-key.ts";
  import RemoveConfirm from "./RemoveConfirm.svelte";

  let {
    core,
    key,
    listed,
    connection,
    onlevel,
    onsaved,
    onremove,
  }: {
    core: Core;
    key: "list" | "add" | IdKey;
    listed: readonly Connection[] | Problem;
    /** The connection the key names, if any. */
    connection: Connection | undefined;
    onlevel: (id: string | null) => void;
    onsaved: () => Promise<void>;
    onremove: (id: number) => Promise<Problem | undefined>;
  } = $props();

  const back = () => {
    onlevel(null);
  };
</script>

{#if key === "add"}
  <Level back={m.settings_connections()} title={m.settings_connection_add()} onback={back}>
    <ConnectionForm {core} {onsaved} />
  </Level>
{:else if connection !== undefined}
  {@const { id, name } = connection}
  <Level back={m.settings_connections()} title={name} onback={back}>
    <ConnectionForm {core} {connection} {onsaved} />
    <RemoveConfirm
      ask={m.settings_connection_remove()}
      {name}
      note={m.settings_connection_remove_note()}
      onremove={() => onremove(id)}
    />
  </Level>
{:else}
  <DrillCard class="min-w-0">
    <ConnectionList
      answer={listed}
      onopen={(id) => {
        onlevel(String(id));
      }}
      onadd={() => {
        onlevel("add");
      }}
    />
  </DrillCard>
{/if}

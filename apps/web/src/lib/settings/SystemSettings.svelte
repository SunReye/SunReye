<!-- The core's own groups' pages, by id: users & access, logs and the danger zone. -->
<script lang="ts">
  import type { Core } from "../api/core";
  import DangerSettings from "./DangerSettings.svelte";
  import LogsSettings from "./LogsSettings.svelte";
  import UsersSettings from "./UsersSettings.svelte";

  let { core, id }: { core: Core; id: string } = $props();
</script>

{#if id === "access"}
  <UsersSettings {core} />
{:else if id === "logs"}
  <div class="drill-card"><LogsSettings {core} /></div>
{:else if id === "danger"}
  <div class="drill-card"><DangerSettings {core} /></div>
{/if}

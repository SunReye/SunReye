<!-- The core's own groups' pages, by id: users & access, logs and the danger zone. -->
<script lang="ts">
  import DrillCard from "../components/drill-in/drill-card.svelte";
  import type { Core } from "../api/core";
  import DangerSettings from "./DangerSettings.svelte";
  import LogsSettings from "./LogsSettings.svelte";
  import UsersSettings from "./UsersSettings.svelte";

  let { core, id }: { core: Core; id: string } = $props();
</script>

{#if id === "access"}
  <UsersSettings {core} />
{:else if id === "logs"}
  <DrillCard><LogsSettings {core} /></DrillCard>
{:else if id === "danger"}
  <DrillCard><DangerSettings {core} /></DrillCard>
{/if}

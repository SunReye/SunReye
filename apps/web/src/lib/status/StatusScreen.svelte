<script lang="ts">
  import type { Core } from "../api/core";
  import { m } from "../paraglide/messages.js";
  import Brokers from "./Brokers.svelte";
  import Log from "./Log.svelte";
  import Problems from "./Problems.svelte";

  let { core }: { core: Core } = $props();

  // Each read again on refresh.
  let problems = $derived(core.problems());
  let connections = $derived(core.connections());
  let logs = $derived(core.logs());

  function refresh(): void {
    problems = core.problems();
    connections = core.connections();
    logs = core.logs();
  }
</script>

<main>
  <button type="button" onclick={refresh}>{m.status_refresh()}</button>
  {#await problems then answer}
    <Problems {answer} />
  {/await}
  <!-- Connections are admin only; a viewer sees no brokers. -->
  {#await connections then answer}
    {#if !("problem" in answer)}
      <Brokers connections={answer} />
    {/if}
  {/await}
  {#await logs then answer}
    <Log {answer} />
  {/await}
</main>

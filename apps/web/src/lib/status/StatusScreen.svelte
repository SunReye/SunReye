<script lang="ts">
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import { Button } from "#lib/components/ui/button/index.js";
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
  <Button variant="outline" size="sm" onclick={refresh}><RefreshCw />{m.status_refresh()}</Button>
  <Problems answer={problems} />
  <!-- Connections are admin only; a viewer sees no brokers. -->
  {#await connections then answer}
    {#if !("problem" in answer)}
      <Brokers connections={answer} />
    {/if}
  {/await}
  <Log answer={logs} />
</main>

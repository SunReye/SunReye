<script lang="ts">
  import PageTitle from "../components/page-title.svelte";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import { Button } from "@sunreye/ui/button";
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

<!-- The settings drill-in's column and surfaces (ADR 21). -->
<main class="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6">
  <header class="flex items-center gap-3 px-1">
    <PageTitle class="flex-1" title={m.nav_status()} />
    <Button variant="ghost" size="sm" class="text-brand" onclick={refresh}>
      <RefreshCw data-icon="inline-start" />{m.status_refresh()}
    </Button>
  </header>
  <Problems answer={problems} />
  <!-- Connections are admin only; a viewer sees no brokers. -->
  <Brokers answer={connections} />
  <Log answer={logs} />
</main>

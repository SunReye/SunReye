<!-- The devices step's scan: an optional network, the scan with its progress, and what it found nothing or was refused. -->
<script lang="ts">
  import TextField from "../components/text-field.svelte";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Search from "@lucide/svelte/icons/search";
  import type { Core, Problem } from "../api/core.ts";
  import type { ScanReport } from "../api/setup.ts";
  import { Button } from "#lib/components/ui/button/index.js";
  import { m } from "../paraglide/messages.js";
  import Refusal from "./Refusal.svelte";

  let { core, onscanned }: { core: Core; onscanned: (endpoints: ScanReport["endpoints"]) => void } =
    $props();

  let subnet = $state("");

  let scanning = $state(false);

  let refused = $state.raw<Problem>();

  /** Endpoints the last scan found; undefined before one. */
  let found = $state<number>();

  async function scan(): Promise<void> {
    scanning = true;
    const report = await core.scan(subnet.trim() === "" ? undefined : subnet.trim());

    scanning = false;
    refused = "problem" in report ? report : undefined;

    if ("problem" in report) return;

    found = report.endpoints.length;
    onscanned(report.endpoints);
  }
</script>

<div class="flex flex-col gap-3">
  <div class="flex flex-col gap-2 sm:flex-row sm:items-end">
    <TextField
      label={m.devices_subnet()}
      class="flex-1"
      placeholder="192.168.1.0/24" autocomplete="off" bind:value={subnet}
    />
    <!-- Primary until it found something: then adding is. -->
    <Button
      variant={found === undefined ? "default" : "outline"}
      disabled={scanning}
      onclick={scan}
    >
      {#if scanning}
        <LoaderCircle data-icon="inline-start" class="motion-safe:animate-spin" />
      {:else}
        <Search data-icon="inline-start" />
      {/if}
      {m.devices_scan()}
    </Button>
  </div>
  {#if scanning}
    <p role="status" class="text-sm text-muted-foreground">{m.devices_scanning()}</p>
  {/if}
  <Refusal {refused} />
  {#if found === 0 && !scanning}
    <div class="rounded-md border border-dashed border-border px-3 py-3 text-sm">
      <p class="font-medium">{m.devices_none()}</p>
      <p class="text-muted-foreground">{m.devices_none_hint()}</p>
    </div>
  {/if}
</div>

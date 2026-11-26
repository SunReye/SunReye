<script lang="ts">
  import LoadingRows from "../components/loading-rows.svelte";
  import type { Core, ImportStatus, Problem, SharedArchive } from "../api/core";
  import { m } from "../paraglide/messages.js";
  import ImportMapping from "./ImportMapping.svelte";
  import ImportOutcome from "./ImportOutcome.svelte";
  import ImportSources from "./ImportSources.svelte";
  import ImportStart from "./ImportStart.svelte";
  import Refusal, { answered } from "../setup/Refusal.svelte";

  let { core }: { core: Core } = $props();

  /** The status is read again this often while an import runs. */
  const POLL_MS = 500;

  /** The source that names the uploaded archive rather than a path under `/share`. */
  const UPLOAD = "upload";

  type V3Device = SharedArchive["devices"][number];

  let status = $state.raw<ImportStatus | Problem>();
  let uploaded = $state.raw<readonly V3Device[]>();

  /** A path under `/share`, or UPLOAD. */
  let source = $state<string>();

  /** The chosen archive's devices. */
  let archive = $state.raw<readonly V3Device[]>();

  /** The v5 device id each v3 slug maps to; empty when it is not imported. */
  let mapping = $state<Record<string, string>>({});
  let refused = $state.raw<Problem>();

  let running = $derived(status !== undefined && "state" in status && status.state === "running");

  void read();

  // Each status read while running schedules the next.
  $effect(() => {
    if (status === undefined || !("state" in status) || status.state !== "running") return;

    const timer = setTimeout(() => void read(), POLL_MS);

    return () => {
      clearTimeout(timer);
    };
  });

  async function read(): Promise<void> {
    status = await core.importStatus();
  }

  async function upload(file: File): Promise<void> {
    const answer = await core.uploadImport(file);

    if ("problem" in answer) {
      refused = answered(answer);

      return;
    }

    refused = undefined;
    uploaded = answer.devices;
    choose(UPLOAD, answer.devices);
  }

  function choose(path: string, devices: readonly V3Device[]): void {
    source = path;
    archive = devices;
  }

  /** A refused start is the confirm's to show, beside its action. */
  async function start(): Promise<Problem | undefined> {
    const chosen = (archive ?? []).flatMap(({ slug }) => {
      const device = mapping[slug] ?? "";

      return device === "" ? [] : [{ slug, device: Number(device) }];
    });

    const answer = await core.startImport(source === UPLOAD ? undefined : source, chosen);

    // A status names a failed import's problem too: only a refusal lacks a state.
    if (!("state" in answer)) return answer;

    refused = undefined;
    status = answer;

    return undefined;
  }
</script>

<!-- Admin only: a refused status read means the panel is not for this session. -->
{#if status === undefined}
  <LoadingRows />
{:else if "state" in status}
  <section aria-labelledby="import-title" class="flex flex-col gap-4 pb-4">
    <header class="flex flex-col gap-1 px-4 pt-4">
      <h2 id="import-title" class="text-[15px] font-medium">{m.import_title()}</h2>
      <p class="text-sm text-muted-foreground">{m.import_note()}</p>
    </header>
    <ImportSources
      {core}
      {uploaded}
      {source}
      disabled={running}
      onchoose={choose}
      onupload={(file) => void upload(file)}
    />
    {#if archive !== undefined}
      <ImportMapping {core} {archive} bind:mapping disabled={running} />
    {/if}
    {#if status.state !== "idle" || refused !== undefined}
      <div class="flex flex-col gap-3 px-4">
        <ImportOutcome {status} />
        <Refusal {refused} />
      </div>
    {/if}
    {#if archive !== undefined}
      <ImportStart disabled={running} onstart={start} />
    {/if}
  </section>
{/if}

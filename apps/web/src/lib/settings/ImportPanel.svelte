<script lang="ts">
  import type { Core, ImportStatus, Problem, SharedArchive } from "../api/core";
  import { problemText } from "../i18n/problems";
  import { m } from "../paraglide/messages.js";
  import ImportMapping from "./ImportMapping.svelte";
  import ImportOutcome from "./ImportOutcome.svelte";
  import ImportSources from "./ImportSources.svelte";

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
      refused = answer;

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

  async function start(): Promise<void> {
    const chosen = (archive ?? []).flatMap(({ slug }) => {
      const device = mapping[slug] ?? "";

      return device === "" ? [] : [{ slug, device: Number(device) }];
    });

    const answer = await core.startImport(source === UPLOAD ? undefined : source, chosen);

    // A status names a failed import's problem too: only a refusal lacks a state.
    if ("state" in answer) {
      refused = undefined;
      status = answer;
    } else {
      refused = answer;
    }
  }
</script>

<!-- Admin only: a refused status read means the panel is not for this session. -->
{#if status !== undefined && "state" in status}
  <section aria-labelledby="import-title">
    <h2 id="import-title">{m.import_title()}</h2>
    <p>{m.import_note()}</p>
    <ImportSources
      {core}
      {uploaded}
      {source}
      disabled={running}
      onchoose={choose}
      onupload={(file) => void upload(file)}
    />
    {#if archive !== undefined}
      <ImportMapping {core} {archive} bind:mapping disabled={running} onstart={start} />
    {/if}
    <ImportOutcome {status} />
    {#if refused !== undefined}
      <p role="alert">{problemText(refused.problem)}</p>
    {/if}
  </section>
{/if}

<style>
  section {
    display: grid;
    gap: 0.5rem;
    justify-items: start;
  }
</style>

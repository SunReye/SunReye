<script lang="ts">
  import type { Core } from "../api/core";
  import LoadingRows from "../components/loading-rows.svelte";
  import { problemText } from "../i18n/problems";
  import { m } from "../paraglide/messages.js";

  let { answer }: { answer: ReturnType<Core["logs"]> } = $props();
</script>

<section aria-label={m.status_logs()}>
  <h2>{m.status_logs()}</h2>
  {#await answer}
    <LoadingRows rows={3} />
  {:then got}
    {#if "problem" in got}
      <p role="alert">{problemText(got.problem)}</p>
    {:else}
      <pre role="log">{got.join("\n")}</pre>
    {/if}
  {/await}
</section>

<style>
  pre {
    max-block-size: 70vh;
    overflow: auto;
    font-size: 0.8rem;
    white-space: pre-wrap;
  }
</style>

<script lang="ts">
  import type { Core } from "../api/core";
  import { problemText } from "../i18n/problems";
  import { m } from "../paraglide/messages.js";

  let { answer }: { answer: Awaited<ReturnType<Core["logs"]>> } = $props();
</script>

<section aria-label={m.status_logs()}>
  <h2>{m.status_logs()}</h2>
  {#if "problem" in answer}
    <p role="alert">{problemText(answer.problem)}</p>
  {:else}
    <pre role="log">{answer.join("\n")}</pre>
  {/if}
</section>

<style>
  pre {
    max-block-size: 70vh;
    overflow: auto;
    font-size: 0.8rem;
    white-space: pre-wrap;
  }
</style>

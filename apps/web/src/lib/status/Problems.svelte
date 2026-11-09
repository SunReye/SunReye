<script lang="ts">
  import type { Core } from "../api/core";
  import { problemText } from "../i18n/problems";
  import { m } from "../paraglide/messages.js";

  let { answer }: { answer: Awaited<ReturnType<Core["problems"]>> } = $props();
</script>

<section aria-label={m.status_problems()}>
  <h2>{m.status_problems()}</h2>
  {#if "problem" in answer}
    <p role="alert">{problemText(answer.problem)}</p>
  {:else if answer.length === 0}
    <p>{m.status_no_problems()}</p>
  {:else}
    <ul>
      {#each answer as condition (condition.code)}
        <li>{problemText(condition.code)}</li>
      {/each}
    </ul>
  {/if}
</section>

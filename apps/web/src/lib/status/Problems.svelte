<script lang="ts">
  import type { Core } from "../api/core";
  import LoadingRows from "../components/loading-rows.svelte";
  import { problemText } from "../i18n/problems";
  import { m } from "../paraglide/messages.js";

  let { answer }: { answer: ReturnType<Core["problems"]> } = $props();
</script>

<section aria-label={m.status_problems()}>
  <h2>{m.status_problems()}</h2>
  {#await answer}
    <LoadingRows rows={1} />
  {:then got}
    {#if "problem" in got}
      <p role="alert">{problemText(got.problem)}</p>
    {:else if got.length === 0}
      <p>{m.status_no_problems()}</p>
    {:else}
      <ul>
        {#each got as condition (condition.code)}
          <li>{problemText(condition.code)}</li>
        {/each}
      </ul>
    {/if}
  {/await}
</section>

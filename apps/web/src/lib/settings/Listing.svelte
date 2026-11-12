<!-- A settings page's list as the core answered it: its refusal, a note when empty, or the items. -->
<script lang="ts" generics="T">
  import type { Snippet } from "svelte";
  import type { Problem } from "../api/core";
  import { problemText } from "../i18n/problems";
  import { m } from "../paraglide/messages.js";

  let { answer, items }: { answer: readonly T[] | Problem; items: Snippet<[readonly T[]]> } =
    $props();
</script>

{#if "problem" in answer}
  <p role="alert" class="p-4">{problemText(answer.problem)}</p>
{:else if answer.length === 0}
  <p class="p-4 text-sm text-muted-foreground">{m.settings_none()}</p>
{:else}
  {@render items(answer)}
{/if}

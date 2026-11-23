<!-- The value editor as the app shows it (ADR 21): a refused or mismatched write, linked to the write log. -->
<script lang="ts">
  import type { ComponentProps } from "svelte";
  import Editor from "@sunreye/builder/components/value-editor/value-editor.svelte";
  import WriteProblem from "./write-problem.svelte";

  let {
    open = $bindable(false),
    ...rest
  }: Omit<ComponentProps<typeof Editor>, "refusal"> = $props();
</script>

<Editor bind:open {...rest} refusal={written} />

{#snippet written(problem: ComponentProps<typeof WriteProblem>["problem"])}
  <WriteProblem {problem} />
{/snippet}

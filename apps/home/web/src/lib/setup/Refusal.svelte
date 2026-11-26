<!-- ADR 21's error treatment: a destructive alert beside the action, which stays for a fix. The
  action plays the `error` haptic as it is refused (`feedback.ts`): a failed read shown here is silent. -->
<script lang="ts" module>
  // The action's side of the pair, beside the alert its callers already import.
  export { answered, refusedInline } from "../feedback.ts";
</script>

<script lang="ts">
  import ProblemAlert from "../components/problem-alert.svelte";
  import type { Problem } from "../api/core.ts";

  let {
    refused,
    text,
  }: {
    refused?: Problem | undefined;
    /** A refusal the SPA itself makes, before asking the core. */
    text?: string | undefined;
  } = $props();
</script>

<ProblemAlert problem={refused?.problem} {text} />

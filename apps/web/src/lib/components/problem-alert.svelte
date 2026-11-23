<!--
  A problem said where it is fixed: the builder's alert with a core problem code in the app's words,
  or a text of the app's own. Nothing without either.
-->
<script lang="ts">
  import { ProblemAlert as Alert } from "@sunreye/builder/controls";
  import { problemText } from "../i18n/problems.ts";

  let {
    problem,
    text,
  }: {
    /** A problem code of the core (ADR 9). */
    problem?: string | undefined;
    text?: string | undefined;
  } = $props();
</script>

<Alert text={text ?? (problem === undefined ? undefined : problemText(problem))} />

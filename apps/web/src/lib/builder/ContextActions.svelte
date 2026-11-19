<!-- The context toolbar's buttons (ADR 20), by what is selected: the wiring mode's modules, a roof
  face, or one object. -->
<script lang="ts">
  import FaceActions from "./FaceActions.svelte";
  import ObjectActions from "./ObjectActions.svelte";
  import SelectionActions from "./SelectionActions.svelte";
  import type { Session } from "./session.svelte.ts";

  let {
    kind,
    session,
    onrefuse,
  }: {
    kind: "selection" | "face" | "object";
    session: Session;
    onrefuse: (reason?: string) => void;
  } = $props();
</script>

{#if kind === "selection"}
  <SelectionActions wiring={session.wiring} strings={session.draft.strings} />
{:else if kind === "face"}
  <FaceActions {session} {onrefuse} />
{:else}
  <ObjectActions {session} {onrefuse} />
{/if}

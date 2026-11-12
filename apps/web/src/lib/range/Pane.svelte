<!--
  One pane of the pager. A pane that fades in with `hold` mounts its content two frames after the
  switch, behind a placeholder of the old height: the frame of the tap only starts the movement,
  the next one builds what arrives (ADR 21).
-->
<script lang="ts" generics="T">
  import type { Snippet } from "svelte";

  let { data, hold = 0, children }: { data: T; hold?: number; children: Snippet<[T]> } = $props();

  // svelte-ignore state_referenced_locally
  let ready = $state(hold <= 0);

  $effect(() => {
    if (ready) return;

    // Two frames: the first callback still belongs to the frame of the tap.
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => {
        ready = true;
      });
    });

    return () => {
      cancelAnimationFrame(id);
    };
  });
</script>

{#if ready}{@render children(data)}{:else}<div style:height="{hold}px"></div>{/if}

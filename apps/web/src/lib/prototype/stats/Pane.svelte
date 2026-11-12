<!--
  PROTOTYPE: one pane of the pager. It gives its content a context of its own, and a pane that fades
  in mounts that content two frames after the switch, behind a placeholder of the old height: the
  frame of the tap only starts the movement, the next one builds what arrives (ADR 21).
-->
<script lang="ts" generics="T">
  import type { Snippet } from "svelte";
  import { setPane } from "./pane";

  let { data, instant, hold = 0, children }: { data: T; instant: boolean; hold?: number; children: Snippet<[T]> } = $props();
  // svelte-ignore state_referenced_locally
  setPane({ instant });
  // svelte-ignore state_referenced_locally
  let ready = $state(hold <= 0);
  $effect(() => {
    if (ready) return;
    // Two frames: the first callback still belongs to the frame of the tap.
    let id = requestAnimationFrame(() => (id = requestAnimationFrame(() => (ready = true))));
    return () => cancelAnimationFrame(id);
  });
</script>

{#if ready}{@render children(data)}{:else}<div style:height="{hold}px"></div>{/if}

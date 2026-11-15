<!-- Test harness: a pager over pages 0 to 3, stepped by a finger drag on its card. -->
<script lang="ts">
  import "../../app.css";
  import Pager, { type Travel } from "./Pager.svelte";

  let { steps }: { steps: (-1 | 1)[] } = $props();

  let n = $state(1);
  let dragged = false;

  let card = $state<HTMLElement | null>(null);

  const peek = (dir: -1 | 1) => {
    const next = n + dir;

    return next >= 0 && next <= 3 ? { id: String(next), data: next } : null;
  };

  const travel = (): Travel => {
    const out: Travel = { kind: dragged ? "slide" : "shift", dir: 1 };

    dragged = false;

    return out;
  };
</script>

<div style="width: 400px" data-testid="card" bind:this={card}>
  <Pager
    surface={card}
    id={String(n)}
    data={n}
    {travel}
    {peek}
    onstep={(dir) => {
      steps.push(dir);
      dragged = true;
      n += dir;
    }}
  >
    {#snippet children(page)}
      <p style="height: 120px">Seite {page}</p>
    {/snippet}
  </Pager>
</div>

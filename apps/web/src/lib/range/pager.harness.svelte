<!--
  Test harness: a pager over pages 0 to 3 on a card, each page taller than the one before, stepped
  by a finger drag on its card, by an arrow that slides or by a tab that swaps in place.
-->
<script lang="ts">
  import "../../app.css";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Card from "#lib/components/ui/card/index.js";
  import Pager from "./Pager.svelte";
  import type { Travel } from "./travel.svelte.ts";

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

<Button
  onclick={() => {
    dragged = true;
    n += 1;
  }}>Später</Button
>
<Button onclick={() => (n += 1)}>Reiter</Button>
<div style="width: 400px">
  <Card.Root class="py-0" data-testid="card" bind:ref={card}>
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
        <p style:height="{80 + page * 40}px">Seite {page}</p>
      {/snippet}
    </Pager>
  </Card.Root>
</div>

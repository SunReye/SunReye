<!--
  Behind every page: only the sun-tinted spotlight under the glass (ADR 21). The core sends the
  tint to every role; without the plant's location it stays indigo.
-->
<script lang="ts">
  import type { PvModel } from "../api/model.ts";
  import { watchTint } from "./spotlight.ts";

  let { core }: { core: Pick<PvModel, "sunTint"> } = $props();

  $effect(() => {
    const root = document.documentElement;

    const stop = watchTint({
      read: () => core.sunTint(),
      set: (tint) => {
        if (tint === undefined) delete root.dataset["tod"];
        else root.dataset["tod"] = tint;
      },
    });

    return () => {
      stop();
      delete root.dataset["tod"];
    };
  });
</script>

<div class="pointer-events-none fixed inset-0 -z-10 bg-background" aria-hidden="true">
  <div class="absolute inset-0 bg-spotlight"></div>
</div>

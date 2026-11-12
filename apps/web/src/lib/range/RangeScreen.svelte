<!-- A screen over one range: its title, the range control on the page's centre line, then the content. -->
<script lang="ts">
  import type { Snippet } from "svelte";
  import type { Ranged } from "./range.ts";
  import RangeControl from "./RangeControl.svelte";

  let { title, model, children }: { title: string; model: Ranged; children: Snippet } = $props();
</script>

<main
  class="mx-auto flex w-full max-w-[1320px] flex-col gap-4 px-3 pt-4 pb-6 sm:px-4 lg:gap-5 lg:px-6 lg:pt-6"
>
  <header
    class="flex flex-wrap items-center gap-x-6 gap-y-3 lg:grid lg:grid-cols-[1fr_540px_1fr] lg:items-start"
  >
    <h1 class="text-xl font-semibold tracking-tight lg:leading-8">{title}</h1>
    <div class="w-full">
      <RangeControl {model} />
    </div>
  </header>
  {@render children()}
</main>

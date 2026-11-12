<!--
  The shell by input and width (ADR 21): the rail with a mouse, or on touch from 768 px; the
  bottom bar below that; nothing around sign-in and setup. Route changes cross-fade.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import * as Tooltip from "#lib/components/ui/tooltip/index.js";
  import type { ShellLayout } from "./input.svelte.ts";
  import Rail, { GUTTER } from "./Rail.svelte";

  let {
    shell,
    current,
    admin,
    children,
  }: {
    /** The layout the input and width call for; `bare` around sign-in and setup. */
    shell: ShellLayout | "bare";
    /** The route id shown. */
    current: string | null;
    /** Whether Controls is listed. */
    admin: boolean;
    children: Snippet;
  } = $props();

  const railed = $derived(shell === "rail" || shell === "rail-open");
</script>

<Tooltip.Provider>
  {#if railed}
    <Rail touch={shell === "rail-open"} {current} {admin} />
  {/if}

  <div class="relative min-h-dvh" style:padding-left="{railed ? GUTTER : 0}px">
    {#key current}
      <!-- No landmark: each screen brings its own `main`. -->
      <div
        class="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-200"
      >
        {@render children()}
      </div>
    {/key}
  </div>
</Tooltip.Provider>

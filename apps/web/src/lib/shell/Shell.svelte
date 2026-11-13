<!--
  The shell by input and width (ADR 21): the rail with a mouse, or on touch from 768 px; the
  bottom bar below that; nothing around sign-in and setup. Route changes cross-fade, at once on
  the still tier.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import * as Tooltip from "#lib/components/ui/tooltip/index.js";
  import { stream } from "../live/stream.svelte.ts";
  import { fade, leave } from "../motion.ts";
  import Connection from "./Connection.svelte";
  import type { ShellLayout } from "./input.svelte.ts";
  import Bar from "./Bar.svelte";
  import { DASHBOARD } from "./nav.ts";
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

  // Off the dashboard, whose headline says it, a halted stream still has to be seen.
  const strip = $derived(stream.halted && current !== DASHBOARD.route);
</script>

<Tooltip.Provider>
  {#if railed}
    <Rail touch={shell === "rail-open"} {current} {admin} />
  {/if}

  <!-- The page ends above the bar; a screen as tall as the screen subtracts `--bar-clear`. -->
  <div
    class={[
      "relative min-h-dvh",
      shell === "bar" &&
        "pb-(--bar-clear) [--bar-clear:calc(84px+env(safe-area-inset-bottom))]",
    ]}
    style:padding-left="{railed ? GUTTER : 0}px"
  >
    {#if strip}
      <Connection strip />
    {/if}
    <!-- One grid cell: the leaving and the arriving screen overlap while they cross-fade. -->
    <div class="grid">
      {#key current}
        <!-- No landmark: each screen brings its own `main`. -->
        <div class="col-start-1 row-start-1 min-w-0" data-screen in:fade>
          <!-- Bears the outro, so the leaving screen fades without going inert. -->
          <span hidden out:leave></span>
          {@render children()}
        </div>
      {/key}
    </div>
  </div>

  {#if shell === "bar"}
    <Bar {current} {admin} />
  {/if}
</Tooltip.Provider>

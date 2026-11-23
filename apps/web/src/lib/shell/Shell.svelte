<!--
  The shell by input and width (ADR 21): the rail with a mouse, or on touch from 768 px; the
  bottom bar below that; nothing around sign-in and setup. Route changes slide by navigation
  order, at once on the still tier.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import { Toaster } from "#lib/components/ui/sonner/index.js";
  import * as Tooltip from "#lib/components/ui/tooltip/index.js";
  import { stream } from "../live/stream.svelte.ts";
  import Connection from "./Connection.svelte";
  import type { ShellLayout } from "@sunreye/builder/shell/input.svelte.ts";
  import Bar from "./Bar.svelte";
  import { DASHBOARD } from "./nav.ts";
  import Rail, { GUTTER } from "./Rail.svelte";
  import { routeSlide } from "./route-slide.ts";

  let {
    shell,
    current,
    admin,
    goto,
    children,
  }: {
    /** The layout the input and width call for; `bare` around sign-in and setup. */
    shell: ShellLayout | "bare";
    /** The route id shown. */
    current: string | null;
    /** Whether Controls is listed. */
    admin: boolean;
    /** SvelteKit's `goto`, for the bar, whose items are no links. */
    goto: (url: string) => Promise<void>;
    children: Snippet;
  } = $props();

  const railed = $derived(shell === "rail" || shell === "rail-open");

  // Off the dashboard, whose headline says it, a halted stream still has to be seen.
  // The route at mount is where the first slide starts from; the transitions follow every later one.
  // svelte-ignore state_referenced_locally
  const { enter, leave } = routeSlide(current);

  const strip = $derived(stream.halted && current !== DASHBOARD.route);

  /** Clear of the bottom bar: its height and the safe area, as `--bar-clear`, and a gap. */
  const ABOVE_BAR = { bottom: "calc(92px + env(safe-area-inset-bottom))" };
</script>

<Tooltip.Provider>
  {#if railed}
    <Rail touch={shell === "rail-open"} {current} {admin} />
  {/if}

  <!-- The page ends above the bar; a screen as tall as the screen subtracts `--bar-clear`. -->
  <div
    class={[
      "relative min-h-dvh",
      shell === "bar" && "pb-(--bar-clear) [--bar-clear:calc(84px+env(safe-area-inset-bottom))]",
    ]}
    style:padding-left="{railed ? GUTTER : 0}px"
  >
    {#if strip}
      <Connection strip />
    {/if}
    <!-- One grid cell, so nothing reflows: the leaving and the arriving screen slide through it. -->
    <div class="grid overflow-x-clip">
      {#key current}
        <!-- No landmark: each screen brings its own `main`. -->
        <div
          class="col-start-1 row-start-1 min-w-0"
          data-screen
          in:enter={current}
          out:leave={current}
        >
          {@render children()}
        </div>
      {/key}
    </div>
  </div>

  {#if shell === "bar"}
    <Bar {current} {admin} {goto} />
  {/if}

  <!-- The one toaster (ADR 21): bottom right beside the rail, above the bar on the phone. -->
  {#if shell === "bar"}
    <Toaster position="bottom-center" offset={ABOVE_BAR} mobileOffset={ABOVE_BAR} />
  {:else}
    <Toaster position="bottom-right" />
  {/if}
</Tooltip.Provider>

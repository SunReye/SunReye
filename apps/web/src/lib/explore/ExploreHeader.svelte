<!-- The range sits on the page's centre line, as in History: the title left of it, the mode right. -->
<script lang="ts">
  import Download from "@lucide/svelte/icons/download";
  import { Button } from "#lib/components/ui/button/index.js";
  import PageTitle from "../components/page-title.svelte";
  import { m } from "../paraglide/messages.js";
  import RangeControl from "../range/RangeControl.svelte";
  import type { Explore } from "./explore.svelte.ts";
  import ModeSwitch from "./ModeSwitch.svelte";
  import { save } from "./save.ts";
  import { OVERLAY_KINDS } from "./overlay.ts";

  let { x }: { x: Explore } = $props();

  const table = $derived(x.table);
</script>

<header
  class="flex flex-wrap items-center gap-x-3 gap-y-3 sm:gap-x-6 lg:grid lg:grid-cols-[1fr_540px_1fr] lg:items-start"
>
  <PageTitle wide class="order-1" title={m.explore_title()} />
  <div class="order-3 w-full lg:order-2">
    <RangeControl model={x.route} kinds={x.view.mode === "overlay" ? OVERLAY_KINDS : undefined} />
  </div>
  <div class="order-2 ml-auto flex items-center gap-1.5 sm:gap-2 lg:order-3 lg:justify-self-end">
    <Button
      variant="outline"
      size="icon-sm"
      aria-label={m.explore_export()}
      title={m.explore_export()}
      disabled={table === null}
      onclick={() => {
        if (table) save(table);
      }}
    >
      <Download />
    </Button>
    <ModeSwitch mode={x.view.mode} onchange={x.setMode} />
  </div>
</header>

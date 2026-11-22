<!-- One string in the Strings group (ADR 20): its colour, name and modules, drilling to it, and
  its warnings under it. -->
<script lang="ts">
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import { Pressable } from "../components/ui/pressable/index.js";
  import { m } from "../paraglide/messages.js";
  import type { WiredIn } from "./modules.ts";
  import { stringCss } from "./scene.ts";

  let {
    name,
    position,
    made,
    warnings,
    onclick,
  }: {
    name: string;
    /** Its position in the layout, which picks its colour. */
    position: number;
    /** What the scene wires into it. */
    made: WiredIn;
    warnings: readonly string[];
    onclick: () => void;
  } = $props();
</script>

<Pressable feedback class="flex min-h-12 w-full items-center gap-3 px-4 py-1.5 text-left" {onclick}>
  <span class="size-3 shrink-0 rounded-sm" style:background={stringCss(position)}></span>
  <span class="flex min-w-0 flex-1 flex-col">
    <span class="truncate text-[15px] font-medium">{name}</span>
    <span class="truncate text-sm text-muted-foreground tabular-nums">
      {m.builder_string_modules(made)}
    </span>
  </span>
  <ChevronRight class="size-4 shrink-0 text-muted-foreground" />
</Pressable>
{#each warnings as warning (warning)}
  <p role="status" class="px-4 pb-1.5 pl-10 text-sm text-warning">{warning}</p>
{/each}

<!--
  The tracing bar's ready shapes (ADR 20): the ready roofs, and the ready dormers once a traced face
  is there to stand on. Picking one holds it; the next tap on the canvas places it.
-->
<script lang="ts">
  import ReadyIcon from "@lucide/svelte/icons/shapes";
  import { readyDormers, readyRoofs, type ReadyEntry } from "@sunreye/scene";
  import { Button } from "@sunreye/ui/button";
  import * as DropdownMenu from "@sunreye/ui/dropdown-menu";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";
  import type { TracingMode } from "./tracing-mode.svelte.ts";

  let { mode, faces }: { mode: TracingMode; faces: boolean } = $props();

  /** A ready roof's size until it is pulled: 10 m by 8 m, eaves at 3 m, its top at 7 m. */
  const ROOF = { width: 10, depth: 8, eave: 3, ridge: 7 };

  /** A ready dormer's size: 2 m across its face, 1.5 m up it. */
  const DORMER = { width: 2, depth: 1.5 };

  const name = (entry: ReadyEntry): string => (getLocale() === "de" ? entry.de : entry.en);
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <Button {...props} variant="outline" size="sm">
        <ReadyIcon data-icon="inline-start" />
        {m.builder_trace_ready()}
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="start" class="max-h-80 w-56 overflow-y-auto">
    <DropdownMenu.Group>
      <DropdownMenu.GroupHeading>{m.builder_trace_roofs()}</DropdownMenu.GroupHeading>
      {#each readyRoofs as roof (roof.id)}
        <DropdownMenu.Item
          class="min-h-11"
          onSelect={() => {
            mode.hold({ kind: "roof", id: roof.id, size: ROOF });
          }}>{name(roof)}</DropdownMenu.Item
        >
      {/each}
    </DropdownMenu.Group>
    {#if faces}
      <DropdownMenu.Separator />
      <DropdownMenu.Group>
        <DropdownMenu.GroupHeading>{m.builder_trace_dormers()}</DropdownMenu.GroupHeading>
        {#each readyDormers as dormer (dormer.id)}
          <DropdownMenu.Item
            class="min-h-11"
            onSelect={() => {
              mode.hold({ kind: "dormer", id: dormer.id, size: DORMER });
            }}>{name(dormer)}</DropdownMenu.Item
          >
        {/each}
      </DropdownMenu.Group>
    {/if}
  </DropdownMenu.Content>
</DropdownMenu.Root>

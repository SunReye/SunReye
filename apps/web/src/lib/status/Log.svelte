<script lang="ts">
  import Section from "../components/section.svelte";
  import type { Core } from "../api/core";
  import { Badge, type BadgeVariant } from "#lib/components/ui/badge/index.js";
  import * as ToggleGroup from "#lib/components/ui/toggle-group/index.js";
  import LoadingRows from "../components/loading-rows.svelte";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";
  import Refusal from "../setup/Refusal.svelte";
  import { keeps, logLine, type Level, type LevelFilter } from "./log-line";

  let { answer }: { answer: ReturnType<Core["logs"]> } = $props();

  let filter = $state<LevelFilter>("all");

  const FILTERS: readonly [LevelFilter, () => string][] = [
    ["all", m.status_level_all],
    ["warn", m.status_level_warn],
    ["error", m.status_level_error],
  ];

  const TONES: Partial<Record<Level, BadgeVariant>> = {
    ERROR: "destructive",
    WARN: "outline",
    INFO: "secondary",
  };

  const time = new Intl.DateTimeFormat(getLocale(), { dateStyle: "short", timeStyle: "medium" });
</script>

<Section card title={m.status_logs()}>
  {#snippet actions()}
    <ToggleGroup.Root
      type="single"
      variant="outline"
      size="sm"
      aria-label={m.status_level()}
      bind:value={() => filter, (next) => (filter = FILTERS.find(([id]) => id === next)?.[0] ?? filter)}
    >
      {#each FILTERS as [id, label] (id)}
        <ToggleGroup.Item value={id} class="px-2.5 text-xs">{label()}</ToggleGroup.Item>
      {/each}
    </ToggleGroup.Root>
  {/snippet}
  {#await answer}
    <LoadingRows rows={3} />
  {:then got}
    {#if "problem" in got}
      <div class="p-4"><Refusal refused={got} /></div>
    {:else}
      {@render lines(got)}
    {/if}
  {/await}
</Section>

{#snippet lines(logged: readonly string[])}
  <!-- Newest first; a line's place in the buffer is its key, as lines may repeat. -->
  {@const shown = logged
    .map((line, at) => ({ at, ...logLine(line) }))
    .filter((line) => keeps(filter, line.level))
    .toReversed()}
  <ul role="log" class="max-h-[70vh] divide-y divide-border/60 overflow-y-auto no-scrollbar">
    {#each shown as line (line.at)}
      <li class="flex flex-col gap-1 px-4 py-2.5">
        {#if line.time !== undefined}
          <div class="flex items-center gap-2">
            {#if line.level !== undefined}
              <Badge variant={TONES[line.level] ?? "ghost"} class="font-mono">{line.level}</Badge>
            {/if}
            <time datetime={line.time} class="text-xs text-muted-foreground tabular-nums">
              {time.format(new Date(line.time))}
            </time>
          </div>
        {/if}
        <p class="font-mono text-xs leading-relaxed break-words">{line.message}</p>
      </li>
    {:else}
      <li class="px-4 py-3.5 text-sm text-muted-foreground">{m.status_log_empty()}</li>
    {/each}
  </ul>
{/snippet}

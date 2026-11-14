<!--
  One line on a state: a warning (a status) or a failure (an alert), with its icon; `muted` is
  the quiet line in the same place, announced only when given a role.
-->
<script lang="ts">
  import type { Component, Snippet } from "svelte";

  const TONES = {
    warning: { colour: "text-warning", role: "status" },
    destructive: { colour: "text-destructive", role: "alert" },
    muted: { colour: "text-muted-foreground", role: undefined },
  } as const;

  let {
    tone,
    icon: Icon,
    role = TONES[tone].role,
    class: className,
    children,
  }: {
    tone: keyof typeof TONES;
    icon?: Component<{ class?: string }>;
    role?: "status" | "alert" | undefined;
    class?: string;
    children: Snippet;
  } = $props();
</script>

<span
  {role}
  class={["flex items-center gap-1.5 text-xs font-medium", TONES[tone].colour, className]}
>
  {#if Icon}<Icon class="size-3.5 shrink-0" />{/if}
  {@render children()}
</span>

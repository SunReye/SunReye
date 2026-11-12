<!-- Setup's header: the brand, its title, the language, and how far the first run has come. -->
<script lang="ts">
  import { Progress } from "#lib/components/ui/progress/index.js";
  import SunMark from "../components/sun-mark.svelte";
  import LocaleSwitch from "../LocaleSwitch.svelte";
  import { m } from "../paraglide/messages.js";
  import type { Locale } from "../paraglide/runtime.js";

  let {
    locale = $bindable(),
    step,
    count,
  }: {
    locale: Locale;
    /** Counted from 1: the step open now, or next. */
    step: number;
    count: number;
  } = $props();

  const progress = $derived(m.setup_progress({ step, count }));
</script>

<header class="flex flex-col gap-3 px-1">
  <div class="flex items-center gap-3">
    <SunMark class="size-7" />
    <h1 class="text-2xl font-semibold tracking-tight">{m.setup_title()}</h1>
    <div class="ml-auto"><LocaleSwitch bind:locale /></div>
  </div>
  <div class="flex items-center gap-3 text-sm text-muted-foreground">
    <span class="whitespace-nowrap tabular-nums">{progress}</span>
    <Progress value={step - 1} max={count} class="flex-1" aria-label={progress} />
  </div>
</header>

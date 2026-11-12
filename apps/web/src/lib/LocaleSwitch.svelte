<!-- The language, where Settings › Display is out of reach: sign-in and setup. -->
<script lang="ts">
  import * as ToggleGroup from "#lib/components/ui/toggle-group/index.js";
  import { haptics } from "./haptics.ts";
  import { endonym, language } from "./i18n/language.svelte.ts";
  import { m } from "./paraglide/messages.js";
  import { isLocale, locales, type Locale } from "./paraglide/runtime.js";

  let { locale = $bindable(language.current) }: { locale?: Locale } = $props();

  async function choose(value: string): Promise<void> {
    if (!isLocale(value) || value === locale) return;

    haptics.selection();
    // No reload: the page renders anew on `locale`.
    await language.choose(value);
    locale = value;
  }
</script>

<ToggleGroup.Root
  type="single"
  size="sm"
  spacing={1}
  bind:value={() => locale, (next) => void choose(next)}
  class="rounded-md p-0.5 ring-1 ring-border/60"
  aria-label={m.locale_label()}
>
  {#each locales as option (option)}
    <ToggleGroup.Item value={option} class="px-3 text-xs">{endonym(option)}</ToggleGroup.Item>
  {/each}
</ToggleGroup.Root>

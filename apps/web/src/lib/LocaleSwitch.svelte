<!-- The language, where Settings › Display is out of reach: sign-in and setup. -->
<script lang="ts">
  import Segmented from "./components/segmented.svelte";
  import { endonym, language } from "./i18n/language.svelte.ts";
  import { m } from "./paraglide/messages.js";
  import { locales, type Locale } from "./paraglide/runtime.js";

  let { locale = $bindable(language.current) }: { locale?: Locale } = $props();

  async function choose(value: Locale): Promise<void> {
    // No reload: the page renders anew on `locale`.
    await language.choose(value);
    locale = value;
  }
</script>

<Segmented
  options={locales.map((option) => [option, endonym(option)] as const)}
  value={locale}
  label={m.locale_label()}
  onchange={(next) => void choose(next)}
/>

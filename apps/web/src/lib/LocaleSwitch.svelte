<script lang="ts">
  import { m } from "./paraglide/messages.js";
  import { endonym, language } from "./i18n/language.svelte.ts";
  import { assertIsLocale, locales, type Locale } from "./paraglide/runtime.js";

  let { locale = $bindable() }: { locale: Locale } = $props();

  async function choose(value: string): Promise<void> {
    const next = assertIsLocale(value);

    // No reload: the page renders anew on `locale`.
    await language.choose(next);
    locale = next;
  }
</script>

<label>
  {m.locale_label()}
  <select
    value={locale}
    onchange={(event) => {
      void choose(event.currentTarget.value);
    }}
  >
    {#each locales as option (option)}
      <option value={option}>{endonym(option)}</option>
    {/each}
  </select>
</label>

<script lang="ts">
  import { m } from "./paraglide/messages.js";
  import { assertIsLocale, locales, setLocale, type Locale } from "./paraglide/runtime.js";

  let { locale = $bindable() }: { locale: Locale } = $props();

  /** Each language in its own name, so an owner finds theirs whatever is shown. */
  function endonym(option: Locale): string {
    return new Intl.DisplayNames([option], { type: "language" }).of(option) ?? option;
  }

  async function choose(value: string): Promise<void> {
    const next = assertIsLocale(value);

    // No reload: the page renders anew on `locale`.
    await setLocale(next, { reload: false });
    locale = next;
  }

  $effect(() => {
    document.documentElement.lang = locale;
  });
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

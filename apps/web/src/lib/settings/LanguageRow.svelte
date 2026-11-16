<!-- Settings › Display: this browser's language, each by its own name. -->
<script lang="ts">
  import SegmentRow from "./SegmentRow.svelte";
  import { haptics } from "../haptics.ts";
  import { endonym, language } from "../i18n/language.svelte.ts";
  import { m } from "../paraglide/messages.js";
  import { isLocale, locales } from "../paraglide/runtime.js";

  function speak(next: string): void {
    if (!isLocale(next) || next === language.current) return;

    haptics.selection();
    void language.choose(next);
  }
</script>

<SegmentRow
  label={m.locale_label()}
  value={language.current}
  options={locales.map((locale) => [locale, endonym(locale)] as const)}
  onchange={speak}
/>

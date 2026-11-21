<!-- Settings › Display: this browser's language, each by its own name. -->
<script lang="ts">
  import SegmentRow from "./SegmentRow.svelte";
  import { endonym, language } from "../i18n/language.svelte.ts";
  import { m } from "../paraglide/messages.js";
  import { locales } from "../paraglide/runtime.js";
</script>

<SegmentRow
  label={m.locale_label()}
  value={language.current}
  options={locales.map((locale) => [locale, endonym(locale)] as const)}
  onchange={(next) => void language.choose(next)}
/>

<!--
  What the root layout sets on <html>: the theme (dark first, ADR 21; a manual choice kept in local
  storage), the motion tier for the CSS motion tokens, the low-power switch's opaque glass, the language,
  and the sun-tinted backdrop behind every page.
-->
<script lang="ts">
  import { ModeWatcher } from "mode-watcher";
  import type { PvModel } from "../api/model.ts";
  import { language } from "../i18n/language.svelte.ts";
  import { motion } from "../motion/tier.svelte.ts";
  import Backdrop from "./Backdrop.svelte";

  let { core }: { core: Pick<PvModel, "sunTint"> } = $props();

  $effect(() => motion.watch());

  $effect(() => {
    document.documentElement.dataset["motion"] = motion.tier;
  });

  $effect(() => {
    document.documentElement.toggleAttribute("data-low-power", motion.lowPower);
  });

  $effect(() => {
    document.documentElement.lang = language.current;
  });
</script>

<ModeWatcher defaultMode="dark" />
<Backdrop {core} />

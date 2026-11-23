<!--
  Settings on the drill-in (ADR 21): a root list of groups, each opening its page, two panes from
  1024 px. A viewer sees only the display, which is the browser's own.
-->
<script lang="ts">
  import PageTitle from "../components/page-title.svelte";
  import { userPrefersMode } from "mode-watcher";
  import type { Core } from "../api/core";
  import DrillIn from "../components/drill-in/drill-in.svelte";
  import { endonym, language } from "../i18n/language.svelte.ts";
  import { motion } from "@sunreye/builder/motion/tier.svelte.ts";
  import { m } from "../paraglide/messages.js";
  import { DISPLAY, settingsGroups } from "./groups.ts";
  import SettingsPage from "./SettingsPage.svelte";

  let {
    core,
    admin,
    open,
    onnavigate,
    level,
    onlevel,
  }: {
    core: Core;
    admin: boolean;
    /** The open group's id, from the hash route; null on the root. */
    open: string | null;
    onnavigate: (id: string | null) => void;
    /** The level open inside the group, such as one device, from the hash route; null on the group's page. */
    level: string | null;
    onlevel: (id: string | null) => void;
  } = $props();

  /** The display's choices in a few words; the other groups have no summary. */
  function summary(id: string): string | undefined {
    if (id !== DISPLAY) return undefined;

    const theme = userPrefersMode.current === "light" ? m.display_light() : m.display_dark();
    const parts = [theme, endonym(language.current)];

    return (motion.lowPower ? [...parts, m.display_low_power()] : parts).join(" · ");
  }
</script>

<main class="contents">
  <DrillIn
    groups={settingsGroups(admin, summary)}
    {open}
    {onnavigate}
    back={m.nav_settings()}
    label={m.settings_groups()}
  >
    {#snippet heading(level)}
      <!-- A page's own header names it. -->
      {#if level === "root"}<PageTitle title={m.nav_settings()} class="px-1" />{/if}
    {/snippet}
    {#snippet page(group)}
      <SettingsPage {core} id={group.id} {level} {onlevel} />
    {/snippet}
  </DrillIn>
</main>

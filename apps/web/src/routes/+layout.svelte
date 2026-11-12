<script lang="ts">
  import type { Snippet } from "svelte";
  import { ModeWatcher } from "mode-watcher";
  import { page } from "$app/state";
  import { connect, http } from "../lib/api/core";
  import Backdrop from "../lib/shell/Backdrop.svelte";
  import { provideAccess } from "../lib/shell/access.svelte.ts";
  import { input } from "../lib/shell/input.svelte.ts";
  import Shell from "../lib/shell/Shell.svelte";
  import "../app.css";
  import { motion } from "../lib/motion/tier.svelte.ts";

  let { children }: { children: Snippet } = $props();

  // The page's directory is the core's root, under an ingress prefix too (ADR 11).
  const core = connect(http(new URL(".", document.baseURI).href));

  const access = provideAccess();

  void access.check(core);

  $effect(() => motion.watch());

  // The CSS motion tokens read the tier (ADR 21).
  $effect(() => {
    document.documentElement.dataset["motion"] = motion.tier;
  });
</script>

<!-- Dark first (ADR 21); a manual choice is kept in local storage. -->
<ModeWatcher defaultMode="dark" />
<Backdrop {core} />
<!-- Sign-in and setup go bare, so the page is never remounted under another parent. -->
<Shell shell={access.bare ? "bare" : input.shell} current={page.route.id} admin={access.admin}>
  {@render children()}
</Shell>

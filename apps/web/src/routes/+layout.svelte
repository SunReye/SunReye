<script lang="ts">
  import type { Snippet } from "svelte";
  import { ModeWatcher } from "mode-watcher";
  import { page } from "$app/state";
  import { connect, http } from "../lib/api/core";
  import { provideAccess } from "../lib/shell/access.svelte.ts";
  import { input } from "../lib/shell/input.svelte.ts";
  import Shell from "../lib/shell/Shell.svelte";
  import "../app.css";

  let { children }: { children: Snippet } = $props();

  // The page's directory is the core's root, under an ingress prefix too (ADR 11).
  const core = connect(http(new URL(".", document.baseURI).href));

  const access = provideAccess();

  void access.check(core);
</script>

<!-- Dark first (ADR 21); a manual choice is kept in local storage. -->
<ModeWatcher defaultMode="dark" />
<!-- Sign-in and setup go bare, so the page is never remounted under another parent. -->
<Shell shell={access.bare ? "bare" : input.shell} current={page.route.id} admin={access.admin}>
  {@render children()}
</Shell>

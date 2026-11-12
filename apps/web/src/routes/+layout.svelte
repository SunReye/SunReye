<script lang="ts">
  import type { Snippet } from "svelte";
  import { page } from "$app/state";
  import { connect, http } from "../lib/api/core";
  import { language } from "../lib/i18n/language.svelte.ts";
  import Backdrop from "../lib/shell/Backdrop.svelte";
  import Document from "../lib/shell/Document.svelte";
  import { provideAccess } from "../lib/shell/access.svelte.ts";
  import { stream } from "../lib/live/stream.svelte.ts";
  import { input } from "../lib/shell/input.svelte.ts";
  import Shell from "../lib/shell/Shell.svelte";
  import "../app.css";

  let { children }: { children: Snippet } = $props();

  // The page's directory is the core's root, under an ingress prefix too (ADR 11).
  const core = connect(http(new URL(".", document.baseURI).href));

  const access = provideAccess();

  void access.check(core);

  // One stream for the connection chip and the glide's stall; none around sign-in and setup.
  $effect(() => (access.bare ? undefined : stream.follow(core)));
</script>

<Document />
<Backdrop {core} />
<!-- Sign-in and setup go bare, so the page is never remounted under another parent. -->
<!-- Messages are no state: a new language renders the app anew; the route keeps its place. -->
{#key language.current}
  <Shell shell={access.bare ? "bare" : input.shell} current={page.route.id} admin={access.admin}>
    {@render children()}
  </Shell>
{/key}

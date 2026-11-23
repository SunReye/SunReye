<script lang="ts">
  import type { Snippet } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { language } from "../lib/i18n/language.svelte.ts";
  import Document from "../lib/shell/Document.svelte";
  import { provideAccess } from "../lib/shell/access.svelte.ts";
  import { stream } from "../lib/live/stream.svelte.ts";
  import { input } from "@sunreye/builder/shell/input.svelte.ts";
  import { connectCore } from "../lib/shell/core.ts";
  import Shell from "../lib/shell/Shell.svelte";
  import "../app.css";

  let { children }: { children: Snippet } = $props();

  const core = connectCore();

  const access = provideAccess();

  void access.check(core);

  // One stream for the connection chip and the glide's stall; none around sign-in and setup.
  $effect(() => (access.bare ? undefined : stream.follow(core)));
</script>

<Document {core} />
<!-- Sign-in and setup go bare, so the page is never remounted under another parent. -->
<!-- Messages are no state: a new language renders the app anew; the route keeps its place. -->
{#key language.current}
  <Shell
    shell={access.bare ? "bare" : input.shell}
    current={page.route.id}
    admin={access.admin}
    {goto}
  >
    {@render children()}
  </Shell>
{/key}

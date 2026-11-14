<!-- While the capabilities come, the root's card stands in skeleton rows of its size. -->
<script lang="ts">
  import GlassCard from "../components/glass-card.svelte";
  import LoadingRows from "../components/loading-rows.svelte";
  import PageTitle from "../components/page-title.svelte";
  import { m } from "../paraglide/messages.js";
</script>

<main class="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6">
  <PageTitle class="px-1" title={m.controls_title()} />
  <GlassCard raised>
    <LoadingRows rows={4} />
  </GlassCard>
</main>

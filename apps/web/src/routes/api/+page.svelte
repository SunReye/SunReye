<script lang="ts">
  import PageTitle from "../../lib/components/page-title.svelte";
  import { m } from "../../lib/paraglide/messages.js";
  import ApiReference from "../../lib/reference/ApiReference.svelte";
  import { useCore } from "../../lib/shell/core.ts";

  const core = useCore();
</script>

<!-- Wide: the reference keeps its own contents column beside the operations (ADR 11). -->
<main class="flex w-full flex-col gap-4 py-6">
  <header class="px-5">
    <PageTitle title={m.api_reference()} />
  </header>
  <ApiReference {core} />
</main>

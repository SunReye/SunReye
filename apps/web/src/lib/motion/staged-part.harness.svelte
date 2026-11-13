<!-- Test harness: a staged part that tells the test it filled. -->
<script lang="ts">
  let { part, onfill }: { part: string; onfill: (part: string) => void } = $props();

  // svelte-ignore state_referenced_locally
  onfill(part);
</script>

<p>{part} filled</p>

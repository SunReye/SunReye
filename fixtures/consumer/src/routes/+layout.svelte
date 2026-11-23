<script lang="ts">
  import "../app.css";
  import { speak } from "@sunreye/builder";

  let { children } = $props();

  // The consumer's language, not the one Home keeps.
  speak("en");
</script>

{@render children()}

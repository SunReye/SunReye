<!-- Test harness: a sentence with a link to a screen and a link that acts. -->
<script lang="ts">
  import TextLink from "./text-link.svelte";

  let { onclick }: { onclick: () => void } = $props();
</script>

<p class="text-sm">
  Gespeichert. <TextLink href="#/settings?group=logs">Protokoll</TextLink> oder
  <TextLink {onclick}>Erneut laden</TextLink>
</p>

<!-- The kit's gallery (#750), in development only: Vite drops the import from every build. -->
{#if import.meta.env.DEV}
  {#await import("../../lib/gallery/Gallery.svelte") then { default: Gallery }}
    <Gallery />
  {/await}
{/if}

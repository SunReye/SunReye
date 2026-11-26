<!-- Test harness: the settings on a stand-in hash router kept in the real browser history. -->
<script lang="ts">
  import type { Core } from "../api/core";
  import { drillRoute, type Router } from "../components/drill-in/route.ts";
  import SettingsScreen from "./SettingsScreen.svelte";

  let { core, group }: { core: Core; group: string } = $props();

  // A root entry to go back to, then the group's, as a tap on its row leaves them.
  history.pushState({}, "", "#/settings");

  // svelte-ignore state_referenced_locally
  history.pushState({ drilled: true }, "", `#/settings?group=${group}`);

  let hash = $state(location.hash);
  let drilled = $state(true);

  function follow(): void {
    const entry: unknown = history.state;

    hash = location.hash;
    drilled = Object.hasOwn(new Object(entry), "drilled");
  }

  const router: Router = {
    page: {
      get url() {
        return { hash };
      },
      get state() {
        return drilled ? { drilled } : {};
      },
    },
    goto: async (url, options) => {
      history[options.replace ? "replaceState" : "pushState"](options.state, "", url);
      follow();
      await Promise.resolve();
    },
  };

  const route = drillRoute(router, "group", { inner: "level" });
  const level = drillRoute(router, "level");
</script>

<svelte:window onpopstate={follow} />

<SettingsScreen
  {core}
  admin
  open={route.open}
  onnavigate={route.navigate}
  level={level.open}
  onlevel={level.navigate}
/>

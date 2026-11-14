<script lang="ts">
  import GaugeIcon from "@lucide/svelte/icons/gauge";
  import HistoryIcon from "@lucide/svelte/icons/history";
  import * as Breadcrumb from "../../components/ui/breadcrumb/index.js";
  import * as NavigationMenu from "../../components/ui/navigation-menu/index.js";
  import * as Pagination from "../../components/ui/pagination/index.js";
  import * as Sidebar from "../../components/ui/sidebar/index.js";
  import * as Tabs from "../../components/ui/tabs/index.js";
  import Demo from "../Demo.svelte";
</script>

<Demo name="tabs">
  <Tabs.Root value="time" class="w-80">
    <Tabs.List>
      <Tabs.Trigger value="time">Time</Tabs.Trigger>
      <Tabs.Trigger value="pattern">Pattern</Tabs.Trigger>
      <Tabs.Trigger value="strings">Strings</Tabs.Trigger>
    </Tabs.List>
    <Tabs.Content value="time" class="text-sm text-muted-foreground">Energy over time.</Tabs.Content>
    <Tabs.Content value="pattern" class="text-sm text-muted-foreground">Hour by weekday.</Tabs.Content>
    <Tabs.Content value="strings" class="text-sm text-muted-foreground">Each string.</Tabs.Content>
  </Tabs.Root>
</Demo>

<Demo name="breadcrumb">
  <Breadcrumb.Root>
    <Breadcrumb.List>
      <Breadcrumb.Item><Breadcrumb.Link href="#/gallery">Settings</Breadcrumb.Link></Breadcrumb.Item>
      <Breadcrumb.Separator />
      <Breadcrumb.Item><Breadcrumb.Link href="#/gallery">Devices</Breadcrumb.Link></Breadcrumb.Item>
      <Breadcrumb.Separator />
      <Breadcrumb.Item><Breadcrumb.Page>Inverter</Breadcrumb.Page></Breadcrumb.Item>
    </Breadcrumb.List>
  </Breadcrumb.Root>
</Demo>

<Demo name="pagination">
  <Pagination.Root count={120} perPage={20} page={2}>
    {#snippet children({ pages, currentPage })}
      <Pagination.Content>
        <Pagination.Item><Pagination.Previous /></Pagination.Item>
        {#each pages as page (page.key)}
          {#if page.type === "ellipsis"}
            <Pagination.Item><Pagination.Ellipsis /></Pagination.Item>
          {:else}
            <Pagination.Item>
              <Pagination.Link {page} isActive={currentPage === page.value}>
                {page.value}
              </Pagination.Link>
            </Pagination.Item>
          {/if}
        {/each}
        <Pagination.Item><Pagination.Next /></Pagination.Item>
      </Pagination.Content>
    {/snippet}
  </Pagination.Root>
</Demo>

<Demo name="navigation-menu">
  <NavigationMenu.Root viewport={false}>
    <NavigationMenu.List>
      <NavigationMenu.Item>
        <NavigationMenu.Trigger>Statistics</NavigationMenu.Trigger>
        <NavigationMenu.Content>
          <NavigationMenu.Link href="#/gallery">Energy</NavigationMenu.Link>
          <NavigationMenu.Link href="#/gallery">Money</NavigationMenu.Link>
        </NavigationMenu.Content>
      </NavigationMenu.Item>
      <NavigationMenu.Item>
        <NavigationMenu.Link href="#/gallery">Forecast</NavigationMenu.Link>
      </NavigationMenu.Item>
    </NavigationMenu.List>
  </NavigationMenu.Root>
</Demo>

<Demo name="sidebar">
  <Sidebar.Provider class="min-h-0 w-56">
    <Sidebar.Root collapsible="none" class="border">
      <Sidebar.Content>
        <Sidebar.Group>
          <Sidebar.GroupLabel>Screens</Sidebar.GroupLabel>
          <Sidebar.Menu>
            <Sidebar.MenuItem>
              <Sidebar.MenuButton isActive><GaugeIcon />Dashboard</Sidebar.MenuButton>
            </Sidebar.MenuItem>
            <Sidebar.MenuItem>
              <Sidebar.MenuButton><HistoryIcon />History</Sidebar.MenuButton>
            </Sidebar.MenuItem>
          </Sidebar.Menu>
        </Sidebar.Group>
      </Sidebar.Content>
    </Sidebar.Root>
  </Sidebar.Provider>
</Demo>

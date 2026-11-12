import Content from "./tabs-content.svelte";
import Trigger from "./tabs-trigger.svelte";
import Root from "./tabs.svelte";
import List, { tabsListVariants, type TabsListVariant } from "./tabs-list.svelte";
// Local: link tabs for the `nav` variant.
import Link from "./tabs-link.svelte";
import Nav from "./tabs-nav.svelte";

export {
  Root,
  Content,
  List,
  Trigger,
  // Local: link tabs for the `nav` variant.
  Link,
  Nav,
  tabsListVariants,
  type TabsListVariant,
  //
  Root as Tabs,
  Content as TabsContent,
  List as TabsList,
  Trigger as TabsTrigger,
  // Local: link tabs for the `nav` variant.
  Link as TabsLink,
  Nav as TabsNav,
};

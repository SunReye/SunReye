// Each settings group's icon, keyed by its id; the keys are the groups.
import Cable from "@lucide/svelte/icons/cable";
import CloudSun from "@lucide/svelte/icons/cloud-sun";
import Cpu from "@lucide/svelte/icons/cpu";
import MapPin from "@lucide/svelte/icons/map-pin";
import Monitor from "@lucide/svelte/icons/monitor";
import PenLine from "@lucide/svelte/icons/pen-line";
import Receipt from "@lucide/svelte/icons/receipt";
import ScrollText from "@lucide/svelte/icons/scroll-text";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import Users from "@lucide/svelte/icons/users";

export const DISPLAY = "display";

export const ICONS = {
  plant: MapPin,
  devices: Cpu,
  // Controls' read-only banner links here by this id.
  writes: PenLine,
  connections: Cable,
  tariff: Receipt,
  forecast: CloudSun,
  access: Users,
  [DISPLAY]: Monitor,
  logs: ScrollText,
  danger: TriangleAlert,
} as const;

/**
 * Type bridge for the automations feature: the client is typed against the
 * exact server/db shapes (type-only imports, nothing bundles) instead of
 * hand-mirroring them. Served by `/api/settings/automations` and, for
 * everything live, by the `automations` topic on the shared socket.
 *
 * LIVE ONLY. There is no `DecisionPoint` here any more: what the optimizer
 * decided is a device's readings now, fetched over `/api/history/rollup` under
 * the `optimizer` slug by `$lib/history/device-series` like every other series
 * in the app. What is left on this bridge is engine STATE and a FORECAST — the
 * two things that are not measurements and have nowhere else to come from.
 */

export type {
  AutomationConfig,
  AutomationStreamMessage,
  Blocker,
  PeakShavingPlan,
  PeakShavingPlans,
  PeakShavingRunState,
  PeakShavingStatus,
  PlanSlot,
} from "@SunReye/contracts/automation";
